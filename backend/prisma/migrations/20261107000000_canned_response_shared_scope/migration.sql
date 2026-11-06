-- A SHARED template is visible to every dashboard user (organisation-wide). TEAM stays in the schema, but the API does
-- not create TEAM templates until Backend 1 can say who is on a team.
ALTER TABLE canned_responses DROP CONSTRAINT canned_responses_scope_check;
ALTER TABLE canned_responses ADD CONSTRAINT canned_responses_scope_check CHECK (scope IN ('PERSONAL', 'TEAM', 'SHARED'));

-- A shortcut means one template to whoever can see it: unique per agent among their active personal templates, and
-- unique (ignoring case) among active shared ones. Deactivating a template frees its shortcut.
CREATE UNIQUE INDEX canned_responses_personal_shortcut_key
  ON canned_responses (created_by, lower(shortcut))
  WHERE scope = 'PERSONAL' AND is_active AND shortcut IS NOT NULL;
CREATE UNIQUE INDEX canned_responses_shared_shortcut_key
  ON canned_responses (lower(shortcut))
  WHERE scope = 'SHARED' AND is_active AND shortcut IS NOT NULL;
