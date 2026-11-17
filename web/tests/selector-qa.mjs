// Ayuda de las pruebas de navegador para el desplegable propio (src/Filtros.tsx): abre el boton y elige una
// opcion por su valor o por su texto visible. Reemplaza a selectOption, que solo sirve con el select nativo.
export async function elegir(page, boton, opcion) {
  const b = typeof boton === 'string' ? page.locator(boton) : boton;
  await b.click();
  const panel = b.locator('xpath=following-sibling::div[contains(@class,"selector-panel")]');
  const o = typeof opcion === 'string' ? panel.locator(`[role=option][data-valor="${opcion}"]`) : panel.locator('[role=option] > span').getByText(opcion.label, { exact: true });
  await o.click();
  await panel.waitFor({ state: 'detached' });
}
export const valorDe = (page, boton) => page.locator(boton).getAttribute('data-valor');
// Abre el desplegable, lee sus opciones y encabezados de grupo, y lo vuelve a cerrar con el mismo boton.
export async function opcionesDe(page, boton) {
  const b = page.locator(boton); await b.click();
  const panel = b.locator('xpath=following-sibling::div[contains(@class,"selector-panel")]'); await panel.waitFor();
  const r = { opciones: await panel.locator('[role=option] > span').allInnerTexts(), grupos: await panel.locator('.selector-grupo').allInnerTexts() };
  await b.click(); await panel.waitFor({ state: 'detached' }); return r;
}
