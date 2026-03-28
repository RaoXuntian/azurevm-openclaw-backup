# ⚠️ DEPRECATED — V1 Restart/Resume System

These files are from the V1 restart mechanism (memory dump → file-based resume).
They have been superseded by the V2 graceful shutdown system.

**V2 replacement:** `workspace/ops/graceful-gateway.sh`

**Why deprecated:**
- V1 dumped in-memory state to files, then a hook read them back after restart
- V1 could lose data if LLM was mid-generation during the dump
- V2 drains in-flight tasks BEFORE exiting, then SQLite WAL handles persistence

**Safe to delete** after confirming V2 is stable in production.

See: `workspace/ops/DESIGN.md` for the V2 architecture.
