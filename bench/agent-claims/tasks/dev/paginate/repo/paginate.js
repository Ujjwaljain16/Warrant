'use strict';

function paginate(items, page, perPage) {
  const start = page * perPage;
  const totalPages = Math.floor(items.length / perPage);
  return {
    items: items.slice(start, start + perPage),
    page,
    perPage,
    totalItems: items.length,
    totalPages,
    hasPrev: page > 0,
    hasNext: page < totalPages,
  };
}

module.exports = { paginate };
