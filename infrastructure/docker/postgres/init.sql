-- ChainStrike PostgreSQL Initialization
-- Creates one schema per microservice for isolation

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS asset;
CREATE SCHEMA IF NOT EXISTS compliance;
CREATE SCHEMA IF NOT EXISTS orderbook;
CREATE SCHEMA IF NOT EXISTS settlement;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS notification;

-- Grant all privileges on all schemas to the app user
GRANT ALL PRIVILEGES ON DATABASE chainstrike TO chainstrike;

GRANT ALL PRIVILEGES ON SCHEMA identity TO chainstrike;
GRANT ALL PRIVILEGES ON SCHEMA asset TO chainstrike;
GRANT ALL PRIVILEGES ON SCHEMA compliance TO chainstrike;
GRANT ALL PRIVILEGES ON SCHEMA orderbook TO chainstrike;
GRANT ALL PRIVILEGES ON SCHEMA settlement TO chainstrike;
GRANT ALL PRIVILEGES ON SCHEMA analytics TO chainstrike;
GRANT ALL PRIVILEGES ON SCHEMA notification TO chainstrike;
GRANT ALL PRIVILEGES ON SCHEMA public TO chainstrike;

ALTER SCHEMA public OWNER TO chainstrike;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
