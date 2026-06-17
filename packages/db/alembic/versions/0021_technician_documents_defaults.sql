-- repair technician_documents column defaults (0020 .py created the table without them)
-- Safe/idempotent. After running, stamp: update alembic_version set version_num =
-- '0021_tech_doc_defaults' where version_num = '0020_technician_documents';
-- (revision id kept <= 32 chars for alembic_version varchar(32))

ALTER TABLE technician_documents ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE technician_documents ALTER COLUMN uploaded_at SET DEFAULT now();
ALTER TABLE technician_documents ALTER COLUMN status SET DEFAULT 'pending_review';
