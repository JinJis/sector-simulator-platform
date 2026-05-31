import asyncio
import logging
import sys
from data_pipeline.main import app
from data_pipeline.jobs.runners import run_news_ingest_5min

logging.basicConfig(level=logging.DEBUG, stream=sys.stdout)
log = logging.getLogger("scratch_test")

async def main():
    # Setup necessary app state attributes mock
    # lifespan handles this usually, let's invoke the lifespan of FastAPI!
    async with app.router.lifespan_context(app):
        log.info("Triggering news_ingest_5min manually...")
        stats = await run_news_ingest_5min(app=app)
        log.info("INGEST STATS COMPLETED:")
        print("Visions Processed:", stats.visions_processed)
        print("Capabilities Processed:", stats.capabilities_processed)
        print("Raw Signals Fetched:", stats.raw_signals_fetched)
        print("Extractor Calls:", stats.extractor_calls)
        print("Extractor Failures:", stats.extractor_failures)
        print("Signals Written:", stats.signals_written)
        print("Cost USD:", stats.extractor_total_cost_usd)
        print("Errors:")
        for err in stats.errors:
            print(" -", err)

if __name__ == "__main__":
    asyncio.run(main())
