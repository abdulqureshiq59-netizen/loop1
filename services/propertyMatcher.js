// services/propertyMatcher.js
// Match customer preferences with properties

const logger = require('../utils/logger');

async function matchProperties(customerPreferences, allProperties) {
  try {
    const { zone, budget, type, bedrooms } = customerPreferences;

    let matched = allProperties.filter(prop => {
      let score = 0;

      // Zone match (40 points)
      if (zone && prop.zone && prop.zone.toLowerCase().includes(zone.toLowerCase())) {
        score += 40;
      }

      // Budget match (30 points)
      if (budget && prop.price) {
        const budgetNum = parseInt(budget);
        const priceNum = parseInt(prop.price);
        const diff = Math.abs(budgetNum - priceNum);
        if (diff < budgetNum * 0.2) { // Within 20%
          score += 30;
        }
      }

      // Type match (20 points)
      if (type && prop.type && prop.type.toLowerCase().includes(type.toLowerCase())) {
        score += 20;
      }

      // Bedrooms match (10 points)
      if (bedrooms && prop.bedrooms === bedrooms) {
        score += 10;
      }

      return score > 0;
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
