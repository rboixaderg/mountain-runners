(function initPlausibleEvents() {
  const eventNames = {
    engagedTime: "Engaged Time",
    scrollDepth: "Scroll Depth",
    uiAction: "UI Action",
  };
  const engagedTimeThresholdsSeconds = [15, 30, 60, 120];
  const scrollDepthThresholds = [50, 90];
  const analyticsAttributeNames = {
    action: "data-analytics-action",
    area: "data-analytics-area",
    target: "data-analytics-target",
  };
  const pageContextMetaNames = {
    locale: "mr-analytics-locale",
    pageType: "mr-analytics-page-type",
  };

  function readMetaContent(name) {
    const meta = document.querySelector(`meta[name="${name}"]`);
    if (!(meta instanceof HTMLMetaElement)) {
      return undefined;
    }

    const content = meta.content.trim();
    return content.length > 0 ? content : undefined;
  }

  function readPageContext() {
    const locale = readMetaContent(pageContextMetaNames.locale) ?? "unknown";
    const pageType = readMetaContent(pageContextMetaNames.pageType) ?? "other";
    const route = window.location.pathname.split("?")[0].split("#")[0];

    return { locale, pageType, route };
  }

  function sanitizeProp(value) {
    const normalized = String(value).trim().slice(0, 64);
    return /^[\w.-]{1,64}$/u.test(normalized) ? normalized : "unknown";
  }

  function sanitizeRoute(pathname) {
    return pathname.slice(0, 120);
  }

  function trackEvent(eventName, props) {
    if (typeof window.plausible !== "function") {
      return;
    }

    try {
      window.plausible(eventName, { props });
    } catch {
      // Analytics must never break navigation.
    }
  }

  function findAnalyticsElement(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    return target.closest(
      `[${analyticsAttributeNames.area}][${analyticsAttributeNames.action}]`,
    );
  }

  function handleActionClick(event) {
    const analyticsElement = findAnalyticsElement(event.target);
    if (analyticsElement === null) {
      return;
    }

    const area = analyticsElement.getAttribute(analyticsAttributeNames.area);
    const action = analyticsElement.getAttribute(
      analyticsAttributeNames.action,
    );
    if (area === null || action === null) {
      return;
    }

    const pageContext = readPageContext();
    const props = {
      action: sanitizeProp(action),
      area: sanitizeProp(area),
      locale: sanitizeProp(pageContext.locale),
      page_type: sanitizeProp(pageContext.pageType),
      route: sanitizeRoute(pageContext.route),
    };

    const target = analyticsElement.getAttribute(
      analyticsAttributeNames.target,
    );
    if (target !== null && target.length > 0) {
      props.target = sanitizeProp(target);
    }

    trackEvent(eventNames.uiAction, props);
  }

  function startEngagedTimeTracking() {
    const pageContext = readPageContext();
    const firedThresholds = new Set();
    let visibleStartedAt = Date.now();
    let visibleElapsedMs = 0;

    function recordVisibleElapsed() {
      visibleElapsedMs += Date.now() - visibleStartedAt;
      visibleStartedAt = Date.now();
    }

    function resetVisibleClock() {
      visibleStartedAt = Date.now();
    }

    function fireDueThresholds(totalVisibleMs) {
      for (const thresholdSeconds of engagedTimeThresholdsSeconds) {
        if (firedThresholds.has(thresholdSeconds)) {
          continue;
        }

        if (totalVisibleMs >= thresholdSeconds * 1000) {
          firedThresholds.add(thresholdSeconds);
          trackEvent(eventNames.engagedTime, {
            locale: sanitizeProp(pageContext.locale),
            page_type: sanitizeProp(pageContext.pageType),
            route: sanitizeRoute(pageContext.route),
            threshold: sanitizeProp(String(thresholdSeconds)),
          });
        }
      }
    }

    function checkThresholds() {
      if (document.visibilityState !== "visible") {
        return;
      }

      fireDueThresholds(visibleElapsedMs + (Date.now() - visibleStartedAt));
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        recordVisibleElapsed();
        fireDueThresholds(visibleElapsedMs);
        return;
      }

      resetVisibleClock();
      checkThresholds();
    });

    window.addEventListener("pagehide", () => {
      recordVisibleElapsed();
      fireDueThresholds(visibleElapsedMs);
    });

    window.setInterval(checkThresholds, 1000);
  }

  function startScrollDepthTracking() {
    const pageContext = readPageContext();
    const firedThresholds = new Set();

    function readScrollRatio() {
      const maxScroll =
        document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll <= 0) {
        return 0;
      }

      return window.scrollY / maxScroll;
    }

    function fireDueThresholds(scrollRatio) {
      for (const threshold of scrollDepthThresholds) {
        if (firedThresholds.has(threshold)) {
          continue;
        }

        if (scrollRatio >= threshold / 100) {
          firedThresholds.add(threshold);
          trackEvent(eventNames.scrollDepth, {
            locale: sanitizeProp(pageContext.locale),
            page_type: sanitizeProp(pageContext.pageType),
            route: sanitizeRoute(pageContext.route),
            threshold: sanitizeProp(String(threshold)),
          });
        }
      }
    }

    function handleScroll() {
      fireDueThresholds(readScrollRatio());
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    // A page loaded already scrolled (restored position or anchor) may never
    // emit a scroll event, so the current ratio is checked once on load.
    fireDueThresholds(readScrollRatio());
  }

  document.addEventListener("click", handleActionClick, { capture: true });
  startEngagedTimeTracking();
  startScrollDepthTracking();
})();
