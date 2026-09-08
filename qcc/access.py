"""Account authorization shared by the legacy and quality APIs."""
from fastapi import HTTPException


ACCOUNT_ROLES = {"QA Auditor", "QA Reviewer", "Operations Manager"}


def is_admin(con, user):
    return bool(con.execute("SELECT 1 FROM user_roles WHERE username=? AND role_name='Administrator'", (user,)).fetchone())


def roles(con, user, account_id=None):
    if is_admin(con, user):
        return ["Administrator"]
    sql = "SELECT DISTINCT role_name FROM account_user_roles WHERE username=?"
    params = [user]
    if account_id is not None:
        sql += " AND account_id=?"
        params.append(account_id)
    return [r[0] for r in con.execute(sql + " ORDER BY role_name", params).fetchall()]


def require(con, user, account_id=None, allowed=()):
    if is_admin(con, user):
        return
    granted = set(roles(con, user, account_id))
    if not granted or (allowed and not granted.intersection(allowed)):
        raise HTTPException(403, "You do not have permission for this account or action")


def scope(con, user, column, account_id=None, process_id=None):
    """Return a SQL predicate; scope before aggregation and pagination."""
    if account_id is not None:
        require(con, user, account_id)
    if process_id is not None:
        process(con, user, process_id, account_id=account_id)
    if is_admin(con, user):
        return "1=1", []
    return f"{column} IN (SELECT account_id FROM account_user_roles WHERE username=?)", [user]


def process(con, user, process_id, allowed=(), active=False, account_id=None):
    row = con.execute("SELECT p.*,a.active account_active FROM processes p JOIN accounts a ON a.id=p.account_id WHERE p.id=?", (process_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Process not found")
    require(con, user, row["account_id"], allowed)
    if account_id is not None and row["account_id"] != account_id:
        raise HTTPException(400, "Process does not belong to the selected account")
    if active and (not row["active"] or not row["account_active"]):
        raise HTTPException(409, "This process or its account is archived")
    return row


def record(con, user, table, key, value, allowed=()):
    if (table, key) not in {("audit_cases", "audit_id"), ("capas", "capa_id"), ("scorecard_versions", "id"), ("sampling_runs", "run_id")}:
        raise ValueError("Unsupported account resource")
    row = con.execute(f"SELECT * FROM {table} WHERE {key}=?", (value,)).fetchone()
    if not row:
        raise HTTPException(404, "Record not found")
    process(con, user, row["process_id"], allowed)
    return row


def staging(con, user, table, key, value):
    if (table, key) not in {("uploads", "upload_id"), ("result_imports", "import_id")}:
        raise ValueError("Unsupported staging resource")
    row = con.execute(f"SELECT * FROM {table} WHERE {key}=?", (value,)).fetchone()
    if not row:
        raise HTTPException(404, "Upload or import not found")
    if not is_admin(con, user) and row["created_by"] != user:
        raise HTTPException(403, "This upload or import belongs to another user")
    return row


def validate_assignee(con, username, account_id, allowed):
    if not username:
        return
    profile = con.execute("SELECT active FROM user_profiles WHERE username=?", (username,)).fetchone()
    if not profile or not profile["active"]:
        raise HTTPException(400, "Select an active user in this account")
    require(con, username, account_id, allowed)


def assignments(con, username):
    groups = {}
    for r in con.execute("SELECT ar.account_id,a.name account_name,ar.role_name FROM account_user_roles ar JOIN accounts a ON a.id=ar.account_id WHERE ar.username=? ORDER BY a.name,ar.role_name", (username,)).fetchall():
        groups.setdefault(r["account_id"], {"account_id": r["account_id"], "account_name": r["account_name"], "roles": []})["roles"].append(r["role_name"])
    return list(groups.values())
