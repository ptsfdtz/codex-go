//! Control the authority's exact active turn, without starting or cloning one.
use crate::{ensure, paths, s, service::Core, Error, Result};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
struct BusySession<'a>(&'a Core, &'a str);
impl Drop for BusySession<'_> {
    fn drop(&mut self) {
        self.0.busy.lock().unwrap().remove(self.1);
    }
}

impl Core {
    pub async fn interrupt_active_turn(&self, session_id: &str, expected: &str) -> Result<Value> {
        {
            let mut busy = self.busy.lock().unwrap();
            ensure(
                busy.insert(session_id.to_owned()),
                "CONFLICT",
                "Conversation operation in progress",
            )?;
        }
        let _busy = BusySession(self, session_id);
        ensure(
            self.verified.load(Ordering::SeqCst),
            "SANDBOX_UNVERIFIED",
            "Native boundary probe must pass before task control",
        )?;
        let active = self.active_upstream_turn(session_id).await?;
        ensure(
            active["upstreamTurnId"] == expected,
            "TURN_CHANGED",
            "The active turn changed; reload before stopping",
        )?;
        let session = self.store.session(session_id)?;
        paths::root(&self.store, s(&session, "projectId"))?;
        let rpc = self.upstream()?;
        // Stopping a Goal must also prevent its scheduler starting another turn.
        let goal = rpc
            .request(
                "thread/goal/get",
                json!({"threadId":session["upstreamThreadId"]}),
            )
            .await?;
        rpc.validate("v2/ThreadGoalGetResponse", &goal)?;
        if goal["goal"]["status"] == "active" {
            let paused = rpc
                .request(
                    "thread/goal/set",
                    crate::composer::goal_params(
                        rpc.protocol(),
                        json!({"threadId":session["upstreamThreadId"],"status":"paused"}),
                        crate::composer::GoalOrigin::User,
                    ),
                )
                .await?;
            rpc.validate("v2/ThreadGoalSetResponse", &paused)?;
        }
        let response = rpc
            .request(
                "turn/interrupt",
                json!({"threadId":session["upstreamThreadId"],"turnId":expected}),
            )
            .await
            .map_err(|error| {
                if ["UPSTREAM_TIMEOUT", "UPSTREAM_UNAVAILABLE"].contains(&error.code.as_str()) {
                    Error::new(
                        "OUTCOME_UNKNOWN",
                        "Stop outcome requires reconciliation; do not resubmit",
                    )
                } else {
                    error
                }
            })?;
        rpc.validate("v2/TurnInterruptResponse", &response)
            .map_err(|_| {
                Error::new(
                    "OUTCOME_UNKNOWN",
                    "Invalid stop acknowledgement; check authoritative state",
                )
            })?;
        let local_turn = self
            .store
            .query(
                "SELECT turnId FROM turns WHERE sessionId=? AND upstreamTurnId=?",
                [session_id, expected],
            )
            .map_err(|_| {
                Error::new(
                    "OUTCOME_UNKNOWN",
                    "Stop accepted but local state is unavailable",
                )
            })?;
        self.store
            .append(
                "turn.interruptRequested",
                json!({"upstreamTurnId":expected}),
                Some(session_id),
                local_turn.first().map(|turn| s(turn, "turnId")),
            )
            .map_err(|_| {
                Error::new(
                    "OUTCOME_UNKNOWN",
                    "Stop accepted but could not be journaled",
                )
            })?;
        // A non-subscribed client may receive no turn/completed notification.
        // Reconcile from the authority; the interrupt acknowledgement is not a terminal state.
        for _ in 0..20 {
            if paths::root(&self.store, s(&session, "projectId")).is_err() {
                break;
            }
            let Ok(turns) = rpc.request("thread/turns/list",json!({"threadId":session["upstreamThreadId"],"limit":1,"sortDirection":"desc","itemsView":"notLoaded"})).await else { break };
            if rpc.validate("v2/ThreadTurnsListResponse", &turns).is_err() {
                break;
            }
            if let Some(turn) = turns["data"].as_array().and_then(|data| data.first()) {
                if turn["id"] != expected {
                    break;
                }
                if crate::tasks::terminal(s(turn, "status")) {
                    self.store.append_native_terminal(session_id,json!({"upstreamTurnId":expected,"status":turn["status"],"error":turn["error"]["message"]})).map_err(|_| Error::new("OUTCOME_UNKNOWN", "Stop accepted but terminal state could not be journaled"))?;
                    break;
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        Ok(json!({"sessionId":session_id,"upstreamTurnId":expected,"requested":true}))
    }

    pub async fn active_upstream_turn(&self, session_id: &str) -> Result<Value> {
        let session = self.store.session(session_id)?;
        let root = paths::root(&self.store, s(&session, "projectId"))?;
        ensure(
            !self.store.thread_deleted(s(&session, "upstreamThreadId"))?,
            "THREAD_NOT_FOUND",
            "Original thread was deleted",
        )?;
        let rpc = self.upstream()?;
        let thread = rpc
            .request(
                "thread/read",
                json!({"threadId":session["upstreamThreadId"],"includeTurns":false}),
            )
            .await?;
        rpc.validate("v2/ThreadReadResponse", &thread)?;
        ensure(
            thread["thread"]["id"] == session["upstreamThreadId"]
                && paths::equal(
                    &root,
                    &paths::canonical(std::path::Path::new(s(&thread["thread"], "cwd")))?,
                ),
            "WORKSPACE_FORBIDDEN",
            "Thread identity or workspace changed",
        )?;
        let turns = rpc.request("thread/turns/list",json!({"threadId":session["upstreamThreadId"],"limit":1,"sortDirection":"desc","itemsView":"notLoaded"})).await?;
        rpc.validate("v2/ThreadTurnsListResponse", &turns)?;
        let data = turns["data"].as_array().unwrap();
        ensure(
            data.len() <= 1,
            "UPSTREAM_PROTOCOL_ERROR",
            "Active turn query exceeded requested limit",
        )?;
        paths::root(&self.store, s(&session, "projectId"))?;
        let active = data
            .first()
            .filter(|turn| turn["status"] == "inProgress")
            .map(|turn| turn["id"].clone());
        ensure(
            active.is_some() || thread["thread"]["status"]["type"] != "active",
            "TURN_STATE_UNAVAILABLE",
            "Active turn identity is not visible yet; retry after refreshing",
        )?;
        Ok(json!({"sessionId":session_id,"upstreamTurnId":active}))
    }

    pub async fn steer_turn(
        &self,
        session_id: &str,
        expected: &str,
        text: &str,
        message_id: &str,
    ) -> Result<Value> {
        ensure(
            !text.trim().is_empty() && text.chars().count() <= 64000 && !expected.is_empty(),
            "INVALID_REQUEST",
            "Invalid additional instruction",
        )?;
        {
            let mut busy = self.busy.lock().unwrap();
            ensure(
                busy.insert(session_id.to_owned()),
                "CONFLICT",
                "Conversation operation in progress",
            )?;
        }
        let _busy = BusySession(self, session_id);
        let result: Result<Value> = async {
            ensure(self.verified.load(Ordering::SeqCst),"SANDBOX_UNVERIFIED","Native boundary probe must pass before instructions")?;
            let active = self.active_upstream_turn(session_id).await?;
            ensure(active["upstreamTurnId"]==expected,"TURN_CHANGED","The active turn changed; reload before sending")?;
            let session = self.store.session(session_id)?;
            paths::root(&self.store,s(&session,"projectId"))?;
            let rpc = self.upstream()?;
            let response = rpc.request("turn/steer",json!({"threadId":session["upstreamThreadId"],"expectedTurnId":expected,"clientUserMessageId":message_id,"input":[{"type":"text","text":text,"text_elements":[]}]})).await.map_err(|error| if ["UPSTREAM_TIMEOUT","UPSTREAM_UNAVAILABLE"].contains(&error.code.as_str()) { Error::new("OUTCOME_UNKNOWN","Additional instruction outcome needs reconciliation; do not resubmit") } else { error })?;
            rpc.validate("v2/TurnSteerResponse",&response).map_err(|_|Error::new("OUTCOME_UNKNOWN","Invalid additional instruction acknowledgement; do not resubmit"))?;
            ensure(response["turnId"]==expected,"OUTCOME_UNKNOWN","Additional instruction outcome needs reconciliation")?;
            let local_turn = self.store.query("SELECT turnId FROM turns WHERE sessionId=? AND upstreamTurnId=?",[session_id,expected]).map_err(|_|Error::new("OUTCOME_UNKNOWN","Instruction accepted but local state is unavailable; do not resubmit"))?;
            self.store.append("turn.steered",json!({"text":text,"upstreamTurnId":expected,"clientUserMessageId":message_id}),Some(session_id),local_turn.first().map(|turn|s(turn,"turnId"))).map_err(|_|Error::new("OUTCOME_UNKNOWN","Instruction was accepted but could not be journaled; do not resubmit"))?;
            Ok(json!({"sessionId":session_id,"upstreamTurnId":expected,"accepted":true}))
        }.await;
        result
    }
}
