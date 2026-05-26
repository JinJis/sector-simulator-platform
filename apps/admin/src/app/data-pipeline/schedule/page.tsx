/**
 * /admin/data-pipeline/schedule — APScheduler arming + orchestrator
 * preview + bot discovery trigger (low-frequency operator tools).
 */

import { SchedulePane } from "@/components/data-pipeline/SchedulePane";

export const dynamic = "force-dynamic";

export default function DataPipelineSchedule() {
  return <SchedulePane />;
}
