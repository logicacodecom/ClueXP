-- technician compliance documents — upload, review, and status tracking
--
-- This adds a `technician_documents` table to track technician compliance documents:
-- - Document upload with storage path
-- - Status: pending_review | approved | rejected (with rejection reason)
-- - Document type and metadata
-- - Expiration date for documents that expire

CREATE TABLE technician_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  document_number TEXT,
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  rejected_reason TEXT,
  expiration_date DATE,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  CHECK (status IN ('pending_review', 'approved', 'rejected'))
);

CREATE INDEX idx_technician_documents_technician_id ON technician_documents (technician_id);
CREATE INDEX idx_technician_documents_status ON technician_documents (status);
