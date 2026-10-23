CREATE TABLE candidate_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  schema_version INTEGER NOT NULL DEFAULT 1,
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE job_evaluations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  profile_revision INTEGER NOT NULL,
  profile_hash TEXT NOT NULL,
  job_hash TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  endpoint_fingerprint TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  gate_state TEXT NOT NULL
    CHECK (gate_state IN ('pass', 'fail', 'needs_review')),
  total_score REAL CHECK (
    total_score IS NULL OR (total_score >= 0 AND total_score <= 100)
  ),
  coverage REAL NOT NULL CHECK (coverage >= 0 AND coverage <= 1),
  inputs_json TEXT NOT NULL CHECK (json_valid(inputs_json)),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  usage_json TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)),
  created_at TEXT NOT NULL,
  UNIQUE (user_id, cache_key)
);

CREATE INDEX job_evaluations_user_job_idx
  ON job_evaluations(user_id, job_id, created_at);

CREATE TABLE application_materials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL
    REFERENCES applications(id) ON DELETE CASCADE,
  evaluation_id TEXT REFERENCES job_evaluations(id) ON DELETE SET NULL,
  source_resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  source_resume_revision INTEGER NOT NULL,
  source_resume_hash TEXT NOT NULL,
  profile_revision INTEGER NOT NULL,
  job_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  inputs_json TEXT NOT NULL CHECK (json_valid(inputs_json)),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  review_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_state IN ('pending', 'passed', 'needs_revision')),
  review_json TEXT CHECK (
    review_json IS NULL OR json_valid(review_json)
  ),
  created_resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  accepted_at TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  usage_json TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, request_key)
);

CREATE INDEX application_materials_user_app_idx
  ON application_materials(user_id, application_id, created_at);

CREATE TABLE application_submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL
    REFERENCES applications(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  resume_revision INTEGER NOT NULL,
  material_id TEXT
    REFERENCES application_materials(id) ON DELETE SET NULL,
  submitted_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  channel TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  snapshot_hash TEXT NOT NULL,
  UNIQUE (application_id, sequence),
  UNIQUE (user_id, request_key)
);

CREATE INDEX application_submissions_user_app_idx
  ON application_submissions(user_id, application_id, submitted_at);
