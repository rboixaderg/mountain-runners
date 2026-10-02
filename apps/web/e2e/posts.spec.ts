import { expect, test } from "@playwright/test";

test("editorial hubs are discoverable and have localized empty states", async ({
  page,
}) => {
  await page.goto("/ca/");
  if (page.viewportSize()!.width < 1024)
    await page.locator("summary").filter({ hasText: "Menú" }).click();
  const navigation = page
    .getByRole("navigation", { name: "Navegació principal" })
    .filter({ visible: true });
  await navigation.getByRole("link", { name: "Notícies", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Notícies" }),
  ).toBeVisible();
  await expect(
    page.getByText("Encara no hi ha publicacions en aquest idioma."),
  ).toBeVisible();
  await page.goto("/es/noticias/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Noticias" }),
  ).toBeVisible();
  await page.goto("/en/blog/");
  await expect(
    page.getByText("There are no publications in this language yet."),
  ).toBeVisible();
});
