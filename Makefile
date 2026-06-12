
# ── Database Safety Commands ──────────────────────────────────────────────────

# Create a timestamped backup of the database before any migrations
backup-db:
	@mkdir -p .db-backups
	@PGPASSWORD=linkedin_email pg_dump -h localhost -p 55432 -U linkedin_email linkedin_email_automator > .db-backups/backup-$(shell date +%Y%m%d-%H%M%S).sql
	@echo "✅ Backup saved to .db-backups/"

# Restore the latest backup
restore-db-latest:
	@LATEST=$$(ls -t .db-backups/*.sql | head -1); \
	PGPASSWORD=linkedin_email psql -h localhost -p 55432 -U linkedin_email linkedin_email_automator < $$LATEST; \
	echo "✅ Restored from $$LATEST"

# List all backups
list-backups:
	@ls -lh .db-backups/*.sql 2>/dev/null || echo "No backups found."
