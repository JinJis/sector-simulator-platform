"""crawler-owned thin asyncpg repos. Narrow on purpose — only the
columns each fetcher needs. The full Prisma client lives in the Node
side; the Python services touch tables directly via asyncpg for the
hot paths."""
