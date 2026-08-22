import {
  sanitizeAnalyticsTarget,
  type AnalyticsAction,
  type AnalyticsArea,
} from "./catalog";

export function analyticsActionAttributes(options: {
  action: AnalyticsAction;
  area: AnalyticsArea;
  target?: string;
}): Record<string, string> {
  const attributes: Record<string, string> = {
    "data-analytics-action": options.action,
    "data-analytics-area": options.area,
  };

  if (options.target !== undefined) {
    attributes["data-analytics-target"] = sanitizeAnalyticsTarget(
      options.target,
    );
  }

  return attributes;
}
