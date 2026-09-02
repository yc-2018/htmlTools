(function initApp(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SalaryGapApp = api;

    const start = function startSalaryGapApp() {
      api.initialize(root.document, root.SalaryGapCalculator, {
        location: root.location,
        history: root.history
      });
    };

    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createApp() {
  const elementIds = [
    'salaryA',
    'salaryB',
    'expenseA',
    'expenseB',
    'expenseLock',
    'lockText',
    'monthA',
    'monthB',
    'yearA',
    'yearB',
    'decadeA',
    'decadeB',
    'statusA',
    'statusB',
    'salaryLine',
    'factPrefix',
    'ratioEmphasis',
    'factSuffix'
  ];
  const urlMoneyKeys = [
    'salaryA',
    'salaryB',
    'expenseA',
    'expenseB'
  ];

  function parseUrlState(urlLike, defaults, calculator) {
    const url = new URL(urlLike, 'http://localhost/');
    const state = {
      ...defaults
    };

    urlMoneyKeys.forEach((key) => {
      const rawValue = url.searchParams.get(key);
      if (
        rawValue !== null
        && calculator.parseMoney(rawValue) !== null
      ) {
        state[key] = rawValue;
      }
    });

    const lockedValue = url.searchParams.get('locked');
    if (lockedValue === '0' || lockedValue === '1') {
      state.locked = lockedValue === '1';
    }

    return state;
  }

  function buildShareUrl(urlLike, state) {
    const url = new URL(urlLike, 'http://localhost/');

    urlMoneyKeys.forEach((key) => {
      url.searchParams.set(key, state[key]);
    });
    url.searchParams.set('locked', state.locked ? '1' : '0');

    return url.href;
  }

  function initialize(doc, calculator, navigation = {}) {
    const elements = Object.fromEntries(
      elementIds.map((id) => [id, doc.getElementById(id)])
    );
    const missingId = elementIds.find((id) => !elements[id]);

    if (missingId) {
      throw new Error(`缺少页面元素：${missingId}`);
    }

    elements.clearButton = doc.getElementById('clearButton');
    elements.resetButton = doc.getElementById('resetButton');

    const lockAttribute = elements.expenseLock.getAttribute('aria-pressed');
    const defaults = {
      salaryA: elements.salaryA.value,
      salaryB: elements.salaryB.value,
      expenseA: elements.expenseA.value,
      expenseB: elements.expenseB.value,
      locked: lockAttribute === null ? true : lockAttribute === 'true'
    };
    const initialState = navigation.location && navigation.location.href
      ? parseUrlState(navigation.location.href, defaults, calculator)
      : defaults;

    elements.salaryA.value = initialState.salaryA;
    elements.salaryB.value = initialState.salaryB;
    const expenseState = calculator.createExpenseLinkState(
      initialState.expenseA,
      initialState.expenseB,
      initialState.locked
    );
    const periodFields = [
      ['month', elements.monthA, elements.monthB],
      ['year', elements.yearA, elements.yearB],
      ['decade', elements.decadeA, elements.decadeB]
    ];

    function renderLockState(state) {
      elements.expenseA.value = state.a;
      elements.expenseB.value = state.b;
      elements.expenseLock.setAttribute('aria-pressed', String(state.locked));
      elements.expenseLock.setAttribute('data-locked', String(state.locked));
      elements.expenseLock.setAttribute(
        'aria-label',
        state.locked
          ? '解除固定消耗同步'
          : '同步固定消耗，以甲为准'
      );
      elements.lockText.textContent = state.locked ? '已同步' : '已解锁';
    }

    function renderConclusion(conclusion) {
      elements.salaryLine.textContent = conclusion.salaryLine;
      elements.factPrefix.textContent = conclusion.factPrefix;
      elements.ratioEmphasis.textContent = conclusion.emphasis;
      elements.factSuffix.textContent = conclusion.factSuffix;
      elements.ratioEmphasis.hidden = !conclusion.emphasis;
    }

    function renderInvalid(result) {
      periodFields.forEach(([, fieldA, fieldB]) => {
        fieldA.textContent = '—';
        fieldB.textContent = '—';
        fieldA.classList.toggle('is-insolvent', false);
        fieldB.classList.toggle('is-insolvent', false);
      });
      elements.statusA.textContent = '';
      elements.statusB.textContent = '';
      renderConclusion(calculator.buildConclusion(result));
    }

    function render() {
      const result = calculator.calculateScenario({
        salaryA: elements.salaryA.value,
        salaryB: elements.salaryB.value,
        expenseA: elements.expenseA.value,
        expenseB: elements.expenseB.value
      });

      if (!result.valid) {
        renderInvalid(result);
        return result;
      }

      periodFields.forEach(([period, fieldA, fieldB]) => {
        fieldA.textContent = calculator.formatMoney(result.people.a[period]);
        fieldB.textContent = calculator.formatMoney(result.people.b[period]);
        fieldA.classList.toggle(
          'is-insolvent',
          result.people.a[period] <= 0
        );
        fieldB.classList.toggle(
          'is-insolvent',
          result.people.b[period] <= 0
        );
      });
      elements.statusA.textContent = result.people.a.month <= 0
        ? '已入不敷出'
        : '';
      elements.statusB.textContent = result.people.b.month <= 0
        ? '已入不敷出'
        : '';
      renderConclusion(calculator.buildConclusion(result));

      return result;
    }

    function syncUrl(result) {
      if (
        !result.valid
        || !navigation.location
        || !navigation.location.href
        || !navigation.history
        || typeof navigation.history.replaceState !== 'function'
      ) {
        return;
      }

      const lockState = expenseState.get();
      const nextUrl = buildShareUrl(navigation.location.href, {
        salaryA: elements.salaryA.value,
        salaryB: elements.salaryB.value,
        expenseA: elements.expenseA.value,
        expenseB: elements.expenseB.value,
        locked: lockState.locked
      });
      navigation.history.replaceState(null, '', nextUrl);
    }

    function renderAndSync() {
      const result = render();
      syncUrl(result);
      return result;
    }

    function clearAllInputs() {
      elements.salaryA.value = '';
      elements.salaryB.value = '';
      expenseState.set('a', '');
      expenseState.set('b', '');
      renderLockState(expenseState.get());
      renderAndSync();
    }

    function resetAllInputs() {
      elements.salaryA.value = defaults.salaryA;
      elements.salaryB.value = defaults.salaryB;

      if (!expenseState.get().locked) {
        expenseState.toggle();
      }
      expenseState.set('a', defaults.expenseA);
      renderLockState(expenseState.get());
      renderAndSync();
    }

    function updateExpense(side, value) {
      const state = expenseState.set(side, value);
      renderLockState(state);
      renderAndSync();
    }

    elements.salaryA.addEventListener('input', renderAndSync);
    elements.salaryB.addEventListener('input', renderAndSync);
    elements.expenseA.addEventListener('input', (event) => {
      updateExpense('a', event.target.value);
    });
    elements.expenseB.addEventListener('input', (event) => {
      updateExpense('b', event.target.value);
    });
    elements.expenseLock.addEventListener('click', () => {
      renderLockState(expenseState.toggle());
      renderAndSync();
    });
    if (elements.clearButton) {
      elements.clearButton.addEventListener('click', clearAllInputs);
    }
    if (elements.resetButton) {
      elements.resetButton.addEventListener('click', resetAllInputs);
    }

    renderLockState(expenseState.get());
    renderAndSync();

    return {
      render
    };
  }

  return {
    initialize,
    parseUrlState,
    buildShareUrl
  };
}));
