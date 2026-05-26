import { NewDecompositionForm } from "./form";

export default function NewAgentRunPage() {
  return (
    <>
      <h2 className="text-base font-semibold text-neutral-50">
        Propose new sector
      </h2>
      <p className="mt-1 text-sm text-neutral-400">
        Run an agent pipeline against a free-form sector concept. The
        result is reviewable before any promotion to a registered sector.
      </p>
      <p className="mt-1 text-[11px] text-neutral-600">
        Three options — pick by depth. Full pipeline (M28) chains six
        agents end-to-end and produces a reviewed Python source file;
        the other two stop earlier and let you iterate manually.
      </p>
      <div className="mt-5">
        <NewDecompositionForm />
      </div>
    </>
  );
}
