-- packages/db/migrations/0002c_audit_log_data_migration.down.sql

DELETE FROM audit_log WHERE action LIKE 'legacy.%';
