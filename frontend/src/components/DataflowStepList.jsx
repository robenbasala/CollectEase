import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import {
  parsePipelineText,
  stringifyPipeline,
  getStepLabel,
  removeStepAt,
  moveStep,
  toggleStepEnabled
} from "../lib/dataflowPipelineUtils.js";

export default function DataflowStepList({ transformationScript, onPipelineChange, disabled }) {
  const pipeline = parsePipelineText(transformationScript) || { version: 1, steps: [] };
  const steps = pipeline.steps || [];

  function commit(nextPipeline) {
    onPipelineChange(stringifyPipeline(nextPipeline));
  }

  if (!steps.length) {
    return (
      <p className="text-muted dataflows-step-list-empty">
        No transformation steps yet. Use the quick transform buttons above to add steps.
      </p>
    );
  }

  return (
    <ol className="dataflows-step-list">
      {steps.map((step, index) => {
        const disabledStep = step.enabled === false;
        return (
          <li key={index} className={`dataflows-step-list__item${disabledStep ? " is-disabled" : ""}`}>
            <div className="dataflows-step-list__main">
              <span className="dataflows-step-list__num">{index + 1}</span>
              <div className="dataflows-step-list__body">
                <strong>{getStepLabel(step)}</strong>
                <span className="text-muted dataflows-step-list__op">{step.op || step.type}</span>
                {disabledStep ? <span className="dataflows-step-list__badge">Disabled</span> : null}
              </div>
            </div>
            <div className="dataflows-step-list__actions">
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                title="Move up"
                disabled={disabled || index === 0}
                onClick={() => commit(moveStep(pipeline, index, -1))}
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                title="Move down"
                disabled={disabled || index === steps.length - 1}
                onClick={() => commit(moveStep(pipeline, index, 1))}
              >
                <ChevronDown size={14} />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                title={disabledStep ? "Enable" : "Disable"}
                disabled={disabled}
                onClick={() => commit(toggleStepEnabled(pipeline, index))}
              >
                {disabledStep ? "Enable" : "Disable"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs dataflows-step-list__del"
                title="Delete"
                disabled={disabled}
                onClick={() => {
                  if (window.confirm(`Remove step ${index + 1}?`)) commit(removeStepAt(pipeline, index));
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
