// Actual built Next UI, SSR included. The loopback API fixture is intentionally
// separate from backend/SQLite tests; no recording key or real login is needed.
describe('profile history and planned list', () => {
  for (const width of [390, 1280]) {
    it(`keeps filters and upcoming metadata at ${width}px without anime for opted-out users`, () => {
      cy.viewport(width, 844);
      cy.setCookie('fixture-profile', '1');
      cy.visit('/watch-history');
      cy.contains('Private history 1').should('be.visible');
      cy.contains('Private history 2').should('not.exist');
      cy.get('select').eq(1).find('option[value="anime"]').should('not.exist');
      cy.get('select').first().select('planned');
      cy.contains('Future film 1').should('be.visible');
      cy.contains('2027').should('be.visible');
      cy.get('select').eq(1).should('be.visible').select('movie');
      cy.contains('Future film 1').should('be.visible');
      cy.get('body').then((body) => {
        expect(body[0].scrollWidth).to.be.at.most(width + 1);
      });
    });
  }
  it('switches ownership across fresh browser sessions and exposes opt-in anime', () => {
    cy.setCookie('fixture-profile', '2');
    cy.visit('/watch-history');
    cy.contains('Private history 2').should('be.visible');
    cy.contains('Private history 1').should('not.exist');
    cy.get('select').eq(1).find('option[value="anime"]').should('exist');
  });
  it('redirects anonymous users to the login page', () => {
    cy.clearCookies();
    cy.visit('/watch-history');
    cy.location('pathname').should('equal', '/login');
    cy.get('[data-testid="email"]').should('be.visible');
  });
});
