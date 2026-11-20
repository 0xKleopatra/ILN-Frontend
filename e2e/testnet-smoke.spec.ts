import { expect, test } from '@playwright/test';
import {
  classifyRouteStatus,
  routeExistsInSource,
  smokeRoutes,
  staleDeploymentMessage,
} from './support/testnet-smoke';

test.describe('Live testnet smoke checks', () => {
  for (const route of smokeRoutes) {
    test(`renders ${route.name} without crashing`, async ({ page }) => {
      const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      const status = response?.status();

      // The live deployment can lag behind this repo. A 404 for a route that is
      // still in source is a deployment problem, not an app regression: skip it
      // with an actionable message instead of failing the nightly run and opening
      // yet another duplicate issue. A route that was really removed still fails.
      if (classifyRouteStatus(status, routeExistsInSource(route.path)) === 'stale-deployment') {
        test.skip(true, staleDeploymentMessage(route.path));
      }

      expect(
        status,
        `${route.path} returned HTTP ${status}; redeploy the testnet build if the route exists in the code`
      ).toBeLessThan(400);
      await expect(page.getByRole('main').first()).toBeVisible({ timeout: 20000 });

      const heading = page.locator('h1, h2').filter({ hasText: route.headingPattern }).first();
      const headingVisible = await heading.isVisible({ timeout: 10000 }).catch(() => false);

      if (!headingVisible) {
        const bodyText = await page.locator('body').textContent();
        expect(bodyText?.length ?? 0).toBeGreaterThan(100);
      }
    });
  }
});
