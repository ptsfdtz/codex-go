CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY,appliedAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects(projectId TEXT PRIMARY KEY,name TEXT NOT NULL,canonicalPath TEXT NOT NULL UNIQUE,identity TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(sessionId TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(projectId),upstreamThreadId TEXT NOT NULL UNIQUE,title TEXT NOT NULL,status TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS turns(turnId TEXT PRIMARY KEY,sessionId TEXT NOT NULL REFERENCES sessions(sessionId),upstreamTurnId TEXT,status TEXT NOT NULL,startedAt TEXT NOT NULL,endedAt TEXT,error TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS turn_upstream ON turns(sessionId,upstreamTurnId) WHERE upstreamTurnId IS NOT NULL;
CREATE TABLE IF NOT EXISTS events(eventId INTEGER PRIMARY KEY AUTOINCREMENT,sessionId TEXT,turnId TEXT,seq INTEGER NOT NULL,action TEXT NOT NULL,payloadJson TEXT NOT NULL,ts TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_session ON events(sessionId,eventId);
CREATE TABLE IF NOT EXISTS approvals(approvalId TEXT PRIMARY KEY,sessionId TEXT NOT NULL REFERENCES sessions(sessionId),turnId TEXT NOT NULL REFERENCES turns(turnId),method TEXT NOT NULL,status TEXT NOT NULL,contextJson TEXT NOT NULL,upstreamRequestJson TEXT NOT NULL,generation TEXT NOT NULL,createdAt TEXT NOT NULL,expiresAt TEXT NOT NULL,resolvedAt TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS approval_upstream ON approvals(generation,upstreamRequestJson);
CREATE TABLE IF NOT EXISTS devices(deviceId TEXT PRIMARY KEY,displayName TEXT NOT NULL,credentialHash TEXT NOT NULL UNIQUE,createdAt TEXT NOT NULL,revokedAt TEXT);
CREATE TABLE IF NOT EXISTS requests(deviceId TEXT NOT NULL,requestId TEXT NOT NULL,requestHash TEXT NOT NULL,status TEXT NOT NULL,responseJson TEXT,createdAt TEXT NOT NULL,PRIMARY KEY(deviceId,requestId));
CREATE TABLE IF NOT EXISTS event_sequences(sessionKey TEXT PRIMARY KEY,seq INTEGER NOT NULL);
INSERT OR IGNORE INTO event_sequences SELECT COALESCE(sessionId,''),MAX(seq) FROM events GROUP BY sessionId;
INSERT OR IGNORE INTO migrations VALUES(1,datetime('now'));
INSERT OR IGNORE INTO migrations VALUES(2,datetime('now'));

CREATE TABLE IF NOT EXISTS session_options(sessionId TEXT PRIMARY KEY REFERENCES sessions(sessionId),archived INTEGER NOT NULL DEFAULT 0,pinned INTEGER NOT NULL DEFAULT 0,model TEXT NOT NULL DEFAULT '',effort TEXT NOT NULL DEFAULT '');
INSERT OR IGNORE INTO migrations VALUES(3,datetime('now'));

CREATE TABLE IF NOT EXISTS session_metadata(sessionId TEXT PRIMARY KEY REFERENCES sessions(sessionId) ON DELETE CASCADE,upstreamJson TEXT NOT NULL,syncedAt TEXT NOT NULL);
INSERT OR IGNORE INTO migrations VALUES(4,datetime('now'));

CREATE TABLE IF NOT EXISTS thread_deletions(threadId TEXT PRIMARY KEY,observedAt TEXT NOT NULL);
INSERT OR IGNORE INTO migrations VALUES(5,datetime('now'));

CREATE TABLE IF NOT EXISTS device_cloud_grants(deviceId TEXT PRIMARY KEY REFERENCES devices(deviceId),issuer TEXT NOT NULL,accountId TEXT NOT NULL,cloudDeviceId TEXT NOT NULL);
INSERT OR IGNORE INTO migrations VALUES(6,datetime('now'));

-- Host-owned, content-addressed files; references survive event journal retention.
CREATE TABLE IF NOT EXISTS attachment_blobs(sha256 TEXT PRIMARY KEY,bytes INTEGER NOT NULL,createdAt TEXT NOT NULL,orphanedAt TEXT);
CREATE TABLE IF NOT EXISTS attachment_refs(attachmentId TEXT PRIMARY KEY,sessionId TEXT NOT NULL REFERENCES sessions(sessionId) ON DELETE CASCADE,scopeKey TEXT NOT NULL,sha256 TEXT NOT NULL REFERENCES attachment_blobs(sha256),name TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(sessionId,scopeKey,sha256,name));
CREATE INDEX IF NOT EXISTS attachment_refs_blob ON attachment_refs(sha256);
INSERT OR IGNORE INTO migrations VALUES(7,datetime('now'));
