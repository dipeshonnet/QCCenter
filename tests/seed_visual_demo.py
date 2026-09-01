"""Create isolated, synthetic data used only for browser/design verification."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / ".visual_demo"
os.environ["QSR_DATA_DIR"] = str(DEMO / "data")
os.environ["QSR_BACKUP_DIR"] = str(DEMO / "backups")
os.environ["QSR_LOG_DIR"] = str(DEMO / "logs")
os.environ["QSR_EXPORT_DIR"] = str(DEMO / "exports")
sys.path.insert(0, str(ROOT))

import app
import quality

now = app.iso_now()
with app.db() as con:
    salt, digest = app.password_hash("qualitydemo")
    con.execute("INSERT OR IGNORE INTO users(username,password_salt,password_hash,created_at) VALUES('admin',?,?,?)", (salt, digest, now))
    con.execute("INSERT OR REPLACE INTO user_profiles(username,display_name,active,must_change_password,updated_at) VALUES('admin','Jane Smith',1,0,?)", (now,))
    con.execute("INSERT OR IGNORE INTO user_roles(username,role_name) VALUES('admin','Administrator')")
    account_id = con.execute("INSERT INTO accounts(name,active,created_at,updated_at) VALUES('Acme Healthcare Services',1,?,?)", (now, now)).lastrowid
    con.execute("INSERT INTO account_config(account_id,updated_at) VALUES(?,?)", (account_id, now))
    order_id = con.execute("INSERT INTO processes(account_id,name,process_type,target_yield,target_sigma,created_at,updated_at) VALUES(?,?,'back_office',96,3.5,?,?)", (account_id, "Order Validation", now, now)).lastrowid
    retention_id = con.execute("INSERT INTO processes(account_id,name,process_type,target_yield,target_sigma,created_at,updated_at) VALUES(?,?,'front_office',92,3.2,?,?)", (account_id, "Customer Retention", now, now)).lastrowid
    con.execute("INSERT INTO process_settings(process_id,baseline_subgroups,critical_capa_enabled,capa_due_days,updated_at) VALUES(?,20,1,14,?)", (order_id, now))
    con.execute("INSERT INTO process_settings(process_id,baseline_subgroups,critical_capa_enabled,capa_due_days,updated_at) VALUES(?,20,1,14,?)", (retention_id, now))

back = quality.create_scorecard(quality.ScorecardIn(process_id=order_id, name="Order Accuracy", passing_score=90, opportunities_per_unit=2), user="admin")
for index, (category, name, critical) in enumerate([
    ("Completeness", "Missing / Incomplete Information", True),
    ("Accuracy", "Incorrect Data Entry", True),
    ("Documentation", "Documentation Error", False),
    ("Duplication", "Duplicate Order", False),
]):
    quality.add_scorecard_item(back["id"], quality.ScorecardItemIn(item_type="defect", category=category, name=name, critical=critical, severity="Critical" if critical else "Major", sort_order=index), user="admin")
quality.publish_scorecard(back["id"], user="admin")

front = quality.create_scorecard(quality.ScorecardIn(process_id=retention_id, name="Retention Conversation", passing_score=85, opportunities_per_unit=5), user="admin")
quality.add_scorecard_item(front["id"], quality.ScorecardItemIn(item_type="question", category="Resolution", name="Issue resolved correctly", weight=60), user="admin")
quality.add_scorecard_item(front["id"], quality.ScorecardItemIn(item_type="sla", category="SLA", name="Callback SLA", weight=40, target=30, usl=30, unit="minutes"), user="admin")
quality.add_scorecard_item(front["id"], quality.ScorecardItemIn(item_type="defect", category="Compliance", name="Critical disclosure missed", critical=True, severity="Critical"), user="admin")
quality.publish_scorecard(front["id"], user="admin")

defects = [
    (11, "Completeness", "Missing / Incomplete Information"),
    (37, "Accuracy", "Incorrect Data Entry"),
    (74, "Documentation", "Documentation Error"),
    (108, "Duplication", "Duplicate Order"),
]
base = datetime.now(timezone.utc) - timedelta(days=29)
with app.db() as con:
    for i in range(125):
        stamp = (base + timedelta(days=i % 30, hours=i % 8)).replace(microsecond=0).isoformat()
        defect = next((x for x in defects if x[0] == i), None)
        opportunities = 2 if i < 92 else 1
        aid = f"DEMO-AUD-{i+1:04d}"
        con.execute("""INSERT INTO audit_cases(audit_id,process_id,external_case_id,scorecard_version_id,assigned_to,status,
            associate,source_json,started_at,submitted_at,reviewed_at,reviewed_by,weighted_score,passed,critical_fail,
            opportunities,defect_count,created_at,created_by) VALUES(?,?,?,?,?,'REVIEWED',?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (aid, order_id, f"WO-{20260000+i}", back["id"], "admin", f"EMP-{100+i%12}", "{}", stamp, stamp, stamp, "admin",
             50 if defect else 100, 0 if defect else 1, 1 if defect else 0, opportunities, 1 if defect else 0, stamp, "admin"))
        if defect:
            con.execute("INSERT INTO audit_defects(audit_id,category,name,severity,critical,opportunities,created_at) VALUES(?,?,?,?,1,1,?)", (aid, defect[1], defect[2], "Critical", stamp))
    for i in range(12):
        stamp = (base + timedelta(days=15+i)).replace(microsecond=0).isoformat()
        aid = f"DEMO-FRONT-{i+1:03d}"
        con.execute("""INSERT INTO audit_cases(audit_id,process_id,external_case_id,scorecard_version_id,assigned_to,status,
            associate,source_json,started_at,submitted_at,weighted_score,opportunities,defect_count,created_at,created_by)
            VALUES(?,?,?,?,?,'SUBMITTED',?,?,?,?,?,5,0,?,?)""", (aid, retention_id, f"CALL-{i+1:05d}", front["id"], "admin", f"AGENT-{i%5+1}", "{}", stamp, stamp, 88+i%8, stamp, "admin"))

for i, (title, priority) in enumerate([
    ("High defects: Missing / Incomplete Information", "CRITICAL"),
    ("SLA breaches exceeding threshold", "CRITICAL"),
    ("Incorrect Data Entry — root cause analysis", "HIGH"),
    ("Callback not within SLA target", "HIGH"),
    ("Documentation errors in order notes", "MEDIUM"),
]):
    due = (datetime.now().date() + timedelta(days=i+1)).isoformat()
    with app.db() as con:
        quality._create_capa(con, order_id if i != 1 else retention_id, None, title, priority, "Jane Smith", due, "admin")

print(f"Demo database ready at {app.DB_PATH}")
