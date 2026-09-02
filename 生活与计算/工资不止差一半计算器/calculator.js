(function initCalculator(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SalaryGapCalculator = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCalculator() {
  function parseMoney(rawValue) {
    const text = String(rawValue).trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
      return null;
    }

    const value = Number(text);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function calculatePerson(name, salary, expense) {
    const month = salary - expense;

    return {
      name,
      salary,
      expense,
      month,
      year: month * 12,
      decade: month * 120
    };
  }

  function comparePeople(personA, personB, field) {
    const valueA = personA[field];
    const valueB = personB[field];

    if (valueA === valueB) {
      return {
        status: 'equal'
      };
    }

    const higher = valueA > valueB ? personA : personB;
    const lower = valueA > valueB ? personB : personA;
    const higherValue = higher[field];
    const lowerValue = lower[field];

    if (lowerValue <= 0) {
      return {
        status: 'unavailable',
        higher,
        lower
      };
    }

    return {
      status: 'ratio',
      higher,
      lower,
      ratio: higherValue / lowerValue
    };
  }

  function formatMoney(value) {
    return new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(value);
  }

  function formatRatio(value) {
    return Number(value.toFixed(2)).toString();
  }

  function buildSalaryLine(comparison) {
    if (comparison.status === 'equal') {
      return '两人的工资相同';
    }

    if (comparison.status === 'unavailable') {
      return `${comparison.higher.name}的工资更高，但工资倍数无法计算`;
    }

    return `你以为${comparison.higher.name}的工资是${comparison.lower.name}的 ${formatRatio(comparison.ratio)} 倍？`;
  }

  function buildConclusion(result) {
    if (!result.valid) {
      return {
        kind: 'invalid',
        salaryLine: result.error,
        factPrefix: '',
        emphasis: '',
        factSuffix: ''
      };
    }

    const salaryLine = buildSalaryLine(result.salaryComparison);
    const insolventPeople = Object.values(result.people)
      .filter((person) => person.month <= 0);

    if (insolventPeople.length > 0) {
      const subject = insolventPeople.length === 2
        ? '两人'
        : insolventPeople[0].name;

      return {
        kind: 'insolvent',
        salaryLine,
        factPrefix: `${subject}已入不敷出，无法用倍数衡量`,
        emphasis: '',
        factSuffix: ''
      };
    }

    if (result.remainingComparison.status === 'equal') {
      return {
        kind: 'equal',
        salaryLine,
        factPrefix: '两人的可支配金额相同',
        emphasis: '',
        factSuffix: ''
      };
    }

    const remaining = result.remainingComparison;
    let factPrefix = `可扣除花销后，${remaining.higher.name}是${remaining.lower.name}的`;

    if (result.salaryComparison.status === 'ratio') {
      factPrefix = result.salaryComparison.higher.name === remaining.higher.name
        ? '可事实却是'
        : `可扣除花销后，${remaining.higher.name}反而是${remaining.lower.name}的`;
    }

    return {
      kind: 'ratio',
      salaryLine,
      factPrefix,
      emphasis: `${formatRatio(remaining.ratio)} 倍`,
      factSuffix: ''
    };
  }

  function createExpenseLinkState(initialA, initialB, initialLocked = true) {
    let a = String(initialA);
    let b = String(initialB);
    let locked = Boolean(initialLocked);

    if (locked) {
      b = a;
    }

    return {
      get() {
        return {
          locked,
          a,
          b
        };
      },
      set(side, value) {
        const next = String(value);

        if (side === 'a') {
          a = next;
        }
        if (side === 'b') {
          b = next;
        }
        if (locked) {
          a = next;
          b = next;
        }

        return this.get();
      },
      toggle() {
        locked = !locked;
        if (locked) {
          b = a;
        }
        return this.get();
      }
    };
  }

  function calculateScenario(rawValues) {
    const values = {
      salaryA: parseMoney(rawValues.salaryA),
      salaryB: parseMoney(rawValues.salaryB),
      expenseA: parseMoney(rawValues.expenseA),
      expenseB: parseMoney(rawValues.expenseB)
    };

    if (Object.values(values).some((value) => value === null)) {
      return {
        valid: false,
        error: '请输入有效的非负金额'
      };
    }

    const people = {
      a: calculatePerson('甲', values.salaryA, values.expenseA),
      b: calculatePerson('乙', values.salaryB, values.expenseB)
    };

    return {
      valid: true,
      people,
      salaryComparison: comparePeople(people.a, people.b, 'salary'),
      remainingComparison: comparePeople(people.a, people.b, 'month')
    };
  }

  return {
    parseMoney,
    calculateScenario,
    formatMoney,
    formatRatio,
    buildConclusion,
    createExpenseLinkState
  };
}));
