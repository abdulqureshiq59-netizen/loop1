// services/propertyMatcher.js
// Match customer preferences with properties

const logger = require('../utils/logger');

// Hard filter (2026-09-19 fix): a customer who wants to BUY was getting a
// rental (Alquiler) property suggested, because the old code only checked
// score > 0 — a zone-only match (40pts) was enough to pass regardless of
// operation or price. This checks the property's actual operation against
// what the customer is looking for; unknown operation on either side is
// left unfiltered rather than excluded (better to show a maybe-relevant
// property than none, when we genuinely don't know).
function operationMatches(leadOperation, propOperation) {
  if (!leadOperation) return true;
  const op = (propOperation || '').toLowerCase();
  if (!op) return true;
  const wantsBuy = leadOperation === 'compra' || leadOperation === 'inversion';
  const wantsRent = leadOperation === 'alquiler';
  if (wantsBuy) return op.includes('venta');
  if (wantsRent) return op.includes('alquiler');
  return true;
}

// Hard filter (2026-09-19 fix): same root cause as above — budget was only
// a scoring bonus, never a requirement, so a property priced wildly outside
// the customer's stated budget (different range, sometimes even a different
// currency, e.g. UYU 41,000 shown against a USD 500,000 budget) could still
// get suggested purely off a zone match. Now a known price outside a 25%
// band around the budget is excluded outright instead of just scored lower.
function budgetMatches(budget, price) {
  if (!budget || !price) return true; // can't compare — don't exclude on a guess
  const budgetNum = parseInt(budget);
  const priceNum = parseInt(price);
  if (!Number.isFinite(budgetNum) || !Number.isFinite(priceNum) || priceNum <= 0) return true;
  const diff = Math.abs(budgetNum - priceNum);
  return diff <= budgetNum * 0.25; // within 25% either way
}

async function matchProperties(customerPreferences, allProperties) {
  try {
    const { operation } = customerPreferences;

    let matched = allProperties.filter(prop => {
      if (!operationMatches(operation, prop.operation)) return false;
      if (!budgetMatches(customerPreferences.budget, prop.price)) return false;
      return calculateScore(prop, customerPreferences) > 0;
    });

    // Sort by score
    matched = matched.sort((a, b) => {
      const scoreA = calculateScore(a, customerPreferences);
      const scoreB = calculateScore(b, customerPreferences);
      return scoreB - scoreA;
    });

    return matched.slice(0, 5); // Top 5 matches
  } catch (err) {
    logger.error('Error matching properties:', err);
    return [];
  }
}

function calculateScore(property, preferences) {
  let score = 0;
  const { zone, budget, type, bedrooms } = preferences;

  if (zone && property.zone && property.zone.toLowerCase().includes(zone.toLowerCase())) {
    score += 40;
  }

  if (budget && property.price) {
    const budgetNum = parseInt(budget);
    const priceNum = parseInt(property.price);
    const diff = Math.abs(budgetNum - priceNum);
    if (diff < budgetNum * 0.2) {
      score += 30;
    }
  }

  if (type && property.type && property.type.toLowerCase().includes(type.toLowerCase())) {
    score += 20;
  }

  if (bedrooms && property.bedrooms === bedrooms) {
    score += 10;
  }

  return score;
}

module.exports = {
  matchProperties,
};
