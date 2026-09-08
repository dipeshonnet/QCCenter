"""Account roles and process sampling controls.

Revision ID: 0002_account_structure
Revises: 0001_postgres_schema
"""
from alembic import op
from qcc.account_schema import statements

revision = "0002_account_structure"
down_revision = "0001_postgres_schema"
branch_labels = None
depends_on = None


def upgrade():
    for statement in statements(postgres=True):
        op.execute(statement)


def downgrade():
    raise RuntimeError("Account grants and process controls cannot be safely collapsed. Restore a pre-migration backup instead.")
