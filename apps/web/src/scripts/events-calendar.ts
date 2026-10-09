function closeCalendarPopovers(calendar: HTMLElement) {
  for (const day of calendar.querySelectorAll(
    ".events-calendar__day--open, .events-calendar__day--preview",
  )) {
    day.classList.remove(
      "events-calendar__day--open",
      "events-calendar__day--preview",
    );
    const button = day.querySelector(".events-calendar__day-button");
    button?.setAttribute("aria-expanded", "false");
  }
}

function previewCalendarDay(day: HTMLElement) {
  if (day.classList.contains("events-calendar__day--open")) return;

  day.classList.add("events-calendar__day--preview");
  day
    .querySelector(".events-calendar__day-button")
    ?.setAttribute("aria-expanded", "true");
}

function closeCalendarDayPreview(day: HTMLElement) {
  if (day.classList.contains("events-calendar__day--open")) return;

  day.classList.remove("events-calendar__day--preview");
  day
    .querySelector(".events-calendar__day-button")
    ?.setAttribute("aria-expanded", "false");
}

function openCalendarDay(day: HTMLElement) {
  const button = day.querySelector(".events-calendar__day-button");
  if (button === null) return;

  day.classList.add("events-calendar__day--open");
  button.setAttribute("aria-expanded", "true");
}

for (const calendarElement of document.querySelectorAll(
  "[data-events-calendar]",
)) {
  if (!(calendarElement instanceof HTMLElement)) continue;
  const calendar = calendarElement;
  const monthContainer = calendar.querySelector("[data-calendar-months]");
  const monthViews = monthContainer?.querySelectorAll<HTMLElement>(
    "[data-calendar-month]",
  );
  const monthCaption = calendar.querySelector("[data-calendar-caption]");
  const previousButton = calendar.querySelector("[data-calendar-previous]");
  const nextButton = calendar.querySelector("[data-calendar-next]");
  if (
    monthContainer instanceof HTMLElement &&
    monthViews !== undefined &&
    monthCaption instanceof HTMLElement &&
    previousButton instanceof HTMLButtonElement &&
    nextButton instanceof HTMLButtonElement
  ) {
    let currentMonth = Number(monthContainer.dataset.currentMonth);
    const showMonth = (monthIndex: number) => {
      const targetMonth = Math.min(
        Math.max(monthIndex, 0),
        monthViews.length - 1,
      );
      monthViews.forEach((monthView, index) => {
        monthView.hidden = index !== targetMonth;
      });
      currentMonth = targetMonth;
      previousButton.disabled = currentMonth === 0;
      nextButton.disabled = currentMonth === monthViews.length - 1;
      monthContainer.dataset.currentMonth = String(currentMonth);
      monthCaption.textContent =
        monthViews[currentMonth].getAttribute("data-month-label");
      closeCalendarPopovers(calendar);
    };
    calendar
      .querySelector("[data-calendar-controls]")
      ?.removeAttribute("hidden");
    previousButton.addEventListener("click", () => showMonth(currentMonth - 1));
    nextButton.addEventListener("click", () => showMonth(currentMonth + 1));
  }

  for (const dayElement of calendar.querySelectorAll(
    ".events-calendar__day--has-events",
  )) {
    if (!(dayElement instanceof HTMLElement)) continue;
    const day = dayElement;

    day.addEventListener("pointerenter", () => previewCalendarDay(day));
    day.addEventListener("pointerleave", () => {
      if (day.contains(document.activeElement)) return;
      closeCalendarDayPreview(day);
    });
    day.addEventListener("focusin", () => previewCalendarDay(day));
    day.addEventListener("focusout", (event) => {
      if (
        (event.relatedTarget instanceof Node &&
          day.contains(event.relatedTarget)) ||
        day.matches(":hover")
      ) {
        return;
      }
      closeCalendarDayPreview(day);
    });
  }

  calendar.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest(".events-calendar__day-button");
    if (button === null) return;

    const day = button.closest(".events-calendar__day--has-events");
    if (day === null || !(day instanceof HTMLElement)) return;

    event.stopPropagation();
    const isOpen = day.classList.contains("events-calendar__day--open");
    closeCalendarPopovers(calendar);
    if (!isOpen) {
      openCalendarDay(day);
    }
  });
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("[data-events-calendar]") !== null) return;

  for (const calendar of document.querySelectorAll("[data-events-calendar]")) {
    if (calendar instanceof HTMLElement) {
      closeCalendarPopovers(calendar);
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  for (const calendar of document.querySelectorAll("[data-events-calendar]")) {
    if (calendar instanceof HTMLElement) {
      for (const day of calendar.querySelectorAll(
        ".events-calendar__day--open, .events-calendar__day--preview",
      )) {
        if (
          day instanceof HTMLElement &&
          day.contains(document.activeElement)
        ) {
          day
            .querySelector<HTMLButtonElement>(".events-calendar__day-button")
            ?.focus();
        }
      }
      closeCalendarPopovers(calendar);
    }
  }
});
