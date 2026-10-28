CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS accounts(
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user','admin')),
    must_change_password BOOLEAN NOT NULL DEFAULT true,
    disabled BOOLEAN NOT NULL DEFAULT false,
    max_hosts INTEGER NOT NULL DEFAULT 10 CHECK(max_hosts BETWEEN 1 AND 1000),
    max_mobile_devices INTEGER NOT NULL DEFAULT 20 CHECK(max_mobile_devices BETWEEN 1 AND 1000),
    max_tunnels INTEGER NOT NULL DEFAULT 64 CHECK(max_tunnels BETWEEN 1 AND 1024),
    bandwidth_bytes_per_second BIGINT NOT NULL DEFAULT 5242880 CHECK(bandwidth_bytes_per_second BETWEEN 65536 AND 1073741824),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS devices(
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    installation_hash TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('desktop','mobile','web','adminWeb')),
    display_name TEXT NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(account_id,installation_hash)
);
CREATE TABLE IF NOT EXISTS hosts(
    host_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL UNIQUE REFERENCES devices(id),
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions(
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(id),
    access_hash TEXT NOT NULL UNIQUE,
    csrf_hash TEXT,
    access_expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '10 minutes',
    refresh_expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '30 days',
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS refresh_tokens(
    hash TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sessions_device ON sessions(device_id);
CREATE INDEX IF NOT EXISTS refresh_session ON refresh_tokens(session_id);
CREATE TABLE IF NOT EXISTS audit(
    id BIGSERIAL PRIMARY KEY,
    actor_id TEXT REFERENCES accounts(id),
    action TEXT NOT NULL,
    subject_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM migrations WHERE version=2) THEN
        ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_kind_check;
        ALTER TABLE devices ADD CONSTRAINT devices_kind_check CHECK(kind IN ('desktop','mobile','web','adminWeb'));
        INSERT INTO migrations(version) VALUES(2);
    END IF;
END $$;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS fingerprint TEXT;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS endpoints JSONB NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS host_access(
    hash TEXT PRIMARY KEY,
    host_id TEXT NOT NULL REFERENCES hosts(host_id) ON DELETE CASCADE,
    host_device_id TEXT NOT NULL REFERENCES devices(id),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '5 minutes'
);
CREATE INDEX IF NOT EXISTS host_access_expiry ON host_access(expires_at);
INSERT INTO migrations(version) VALUES(3) ON CONFLICT DO NOTHING;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS custom_name TEXT;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS custom_name_configured BOOLEAN NOT NULL DEFAULT false;
INSERT INTO migrations(version) VALUES(4) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS chat_providers(
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    models JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_provider_account ON chat_providers(account_id);
CREATE TABLE IF NOT EXISTS chat_conversations(
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_conversation_account ON chat_conversations(account_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS chat_messages(
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('complete','running','stopped','failed','interrupted')),
    error TEXT,
    provider_id TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(conversation_id,request_id,role)
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_one_generation ON chat_messages(conversation_id) WHERE status='running';
INSERT INTO migrations(version) VALUES(5) ON CONFLICT DO NOTHING;
ALTER TABLE chat_providers ADD COLUMN IF NOT EXISTS model_efforts JSONB NOT NULL DEFAULT '{}';
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS effort TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS effort TEXT NOT NULL DEFAULT '';
INSERT INTO migrations(version) VALUES(6) ON CONFLICT DO NOTHING;
