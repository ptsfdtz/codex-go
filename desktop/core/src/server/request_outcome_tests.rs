use super::{mutation_error, save_mutation_response};
use crate::{store::Store, Error};
use serde_json::json;

#[test]
fn lost_rejection_is_queryable_and_cannot_execute_again() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::open(&directory.path().join("requests.db")).unwrap();
    let payload = json!({"sessionId":"test-session"});
    store
        .reserve("device", "request", "turn.start", &payload)
        .unwrap();
    let response =
        mutation_error(Error::new("CONFLICT", "Session is busy")).packet(Some("request"));
    save_mutation_response(&store, "device", "request", &response).unwrap();
    let status = store.request_status("device", "request").unwrap();
    assert_eq!(status["status"], "done");
    assert_eq!(status["response"], response);
    assert_eq!(
        store
            .reserve("device", "request", "turn.start", &payload)
            .unwrap(),
        Some(response)
    );
    assert_eq!(
        store.request_status("other-device", "request").unwrap()["status"],
        "notFound"
    );
}

#[test]
fn ambiguous_failures_keep_their_identity_and_never_become_safe_retries() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::open(&directory.path().join("requests.db")).unwrap();
    for code in [
        "OUTCOME_UNKNOWN",
        "UPSTREAM_TIMEOUT",
        "UPSTREAM_UNAVAILABLE",
        "UPSTREAM_PROTOCOL_ERROR",
        "DATABASE_ERROR",
        "IO_ERROR",
    ] {
        let payload = json!({"sessionId":"test-session"});
        store
            .reserve("device", code, "turn.start", &payload)
            .unwrap();
        let response = mutation_error(Error::new(code, "Delivery unconfirmed")).packet(Some(code));
        save_mutation_response(&store, "device", code, &response).unwrap();
        let status = store.request_status("device", code).unwrap();
        assert_eq!(status["status"], "unknown");
        assert_eq!(status["response"]["code"], "OUTCOME_UNKNOWN");
        assert_eq!(
            store
                .reserve("device", code, "turn.start", &payload)
                .unwrap(),
            Some(response)
        );
    }
}

#[test]
fn missing_reservation_cannot_be_reported_as_saved() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::open(&directory.path().join("requests.db")).unwrap();
    let response = json!({"type":"response","id":"missing","payload":{}});
    let error = save_mutation_response(&store, "device", "missing", &response).unwrap_err();
    assert_eq!(error.code, "DATABASE_ERROR");
}
