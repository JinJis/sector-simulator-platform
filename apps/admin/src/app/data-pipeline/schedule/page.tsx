/**
 * /admin/data-pipeline/schedule — APScheduler arming + orchestrator
 * preview + bot discovery trigger (low-frequency operator tools).
 */

import { CronScheduleList } from "@/components/data-pipeline/CronScheduleList";
import { SchedulePane } from "@/components/data-pipeline/SchedulePane";

export const dynamic = "force-dynamic";

export default function DataPipelineSchedule() {
  return (
    <div className="flex flex-col gap-6">
      <CronScheduleList />
      <SchedulePane />
    </div>
  );
}
