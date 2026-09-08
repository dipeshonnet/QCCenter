"""Version 3 migration statements for SQLite and PostgreSQL."""


def statements(postgres=False):
    username = "citext" if postgres else "TEXT"
    identity = "bigint" if postgres else "INTEGER"
    timestamp = "timestamptz" if postgres else "TEXT"
    return [
        f"""CREATE TABLE account_user_roles (
            username {username} NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            account_id {identity} NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            role_name TEXT NOT NULL REFERENCES roles(name) CHECK(role_name IN ('QA Auditor','QA Reviewer','Operations Manager')),
            PRIMARY KEY(username,account_id,role_name))""",
        "CREATE INDEX ix_account_user_roles_account ON account_user_roles(account_id,username)",
        f"""CREATE TABLE legacy_user_roles (
            username {username} NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            role_name TEXT NOT NULL, PRIMARY KEY(username,role_name))""",
        "INSERT INTO legacy_user_roles SELECT username,role_name FROM user_roles WHERE role_name<>'Administrator'",
        "DELETE FROM user_roles WHERE role_name<>'Administrator'",
        f"""CREATE TABLE process_sampling_config (
            process_id {identity} PRIMARY KEY REFERENCES processes(id) ON DELETE CASCADE,
            coverage_enabled INTEGER NOT NULL DEFAULT 0 CHECK(coverage_enabled IN (0,1)),
            coverage_period TEXT NOT NULL DEFAULT 'week' CHECK(coverage_period IN ('day','week','month')),
            audits_per_associate INTEGER NOT NULL DEFAULT 3 CHECK(audits_per_associate>0),
            identifier_column_default TEXT, associate_column_default TEXT,
            exclude_previously_sampled INTEGER NOT NULL DEFAULT 1 CHECK(exclude_previously_sampled IN (0,1)),
            case_insensitive_ids INTEGER NOT NULL DEFAULT 1 CHECK(case_insensitive_ids IN (0,1)),
            updated_at {timestamp} NOT NULL)""",
        """INSERT INTO process_sampling_config
            SELECT p.id,COALESCE(c.coverage_enabled,0),COALESCE(c.coverage_period,'week'),COALESCE(c.audits_per_associate,3),
            c.identifier_column_default,c.associate_column_default,COALESCE(c.exclude_previously_sampled,1),
            COALESCE(c.case_insensitive_ids,1),p.updated_at
            FROM processes p LEFT JOIN account_config c ON c.account_id=p.account_id""",
        f"ALTER TABLE uploads ADD COLUMN created_by {username} REFERENCES users(username)",
    ]


def initialize_process(con, process_id, now):
    con.execute("INSERT OR IGNORE INTO process_sampling_config(process_id,updated_at) VALUES(?,?)", (process_id, now))


def sampling_config(con, process_id):
    row = con.execute("SELECT * FROM process_sampling_config WHERE process_id=?", (process_id,)).fetchone()
    if row:
        return dict(row)
    return dict(process_id=process_id, coverage_enabled=0, coverage_period="week", audits_per_associate=3,
                identifier_column_default=None, associate_column_default=None, exclude_previously_sampled=1,
                case_insensitive_ids=1)
