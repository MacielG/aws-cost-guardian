describe('Admin Flow', () => {
  beforeEach(() => {
    // Set up API interceptors for mocking
    cy.intercept('GET', '**/admin/metrics', { fixture: 'admin-metrics.json' }).as('getMetrics');
    cy.intercept('GET', '**/admin/settings', { fixture: 'admin-settings.json' }).as('getSettings');
    cy.intercept('PUT', '**/admin/settings', { statusCode: 200 }).as('updateSettings');
    cy.intercept('POST', '**/admin/coupons', { statusCode: 200 }).as('createCoupon');
    cy.intercept('DELETE', '**/admin/coupons/*', { statusCode: 200 }).as('deleteCoupon');
  });

  it('should load admin dashboard with metrics', () => {
    // Mock admin authentication
    cy.window().then((win) => {
      win.localStorage.setItem('amplify-auth', JSON.stringify({
        user: {
          'cognito:groups': ['Admins'],
          username: 'admin-user',
        }
      }));
    });

    cy.visit('/admin');

    // Wait for metrics API call
    cy.wait('@getMetrics');

    // Check if key metrics are displayed
    cy.contains('Total Clientes').should('be.visible');
    cy.contains('Receita (Mês)').should('be.visible');
    cy.contains('Taxa Conversão').should('be.visible');
    cy.contains('Execuções').should('be.visible');
  });

  it('should allow updating commission rate', () => {
    // Mock admin authentication
    cy.window().then((win) => {
      win.localStorage.setItem('amplify-auth', JSON.stringify({
        user: {
          'cognito:groups': ['Admins'],
          username: 'admin-user',
        }
      }));
    });

    cy.visit('/admin');

    cy.wait('@getSettings');

    // Find commission rate input
    cy.get('input[placeholder="30"]').clear().type('35');

    // Click update button
    cy.contains('Atualizar').click();

    // Wait for API call
    cy.wait('@updateSettings');

    // Check for success message (assuming toast is shown)
    cy.contains('Taxa de comissão atualizada').should('be.visible');
  });

  it('should create a new coupon', () => {
    // Mock admin authentication
    cy.window().then((win) => {
      win.localStorage.setItem('amplify-auth', JSON.stringify({
        user: {
          'cognito:groups': ['Admins'],
          username: 'admin-user',
        }
      }));
    });

    cy.visit('/admin');

    cy.wait('@getSettings');

    // Fill coupon form
    cy.get('input[placeholder="Código do cupom"]').type('TEST20');
    cy.get('input[placeholder="Valor"]').type('20');
    cy.get('input[type="datetime-local"]').type('2025-12-31T23:59');
    cy.get('input[placeholder="Descrição"]').type('Test coupon');

    // Create coupon
    cy.contains('Criar Cupom').click();

    // Wait for API call
    cy.wait('@createCoupon');

    // Check for success message
    cy.contains('Cupom criado com sucesso').should('be.visible');
  });

  it('should redirect non-admin users', () => {
    // Mock non-admin user
    cy.window().then((win) => {
      win.localStorage.setItem('amplify-auth', JSON.stringify({
        user: {
          'cognito:groups': ['Users'], // Not admin
          username: 'regular-user',
        }
      }));
    });

    cy.visit('/admin');

    // Should redirect to dashboard
    cy.url().should('include', '/dashboard');
  });

  it('should handle API errors gracefully', () => {
    // Mock admin authentication
    cy.window().then((win) => {
      win.localStorage.setItem('amplify-auth', JSON.stringify({
        user: {
          'cognito:groups': ['Admins'],
          username: 'admin-user',
        }
      }));
    });

    // Intercept with error
    cy.intercept('GET', '**/admin/metrics', { statusCode: 500 }).as('getMetricsError');

    cy.visit('/admin');

    // Should show error message
    cy.contains('Erro ao carregar métricas admin').should('be.visible');
  });
});
