'use strict';

// Stand-in for a project's babel transformer: echoes the source it receives.
module.exports = {
  transform: ({ src }) => ({ src }),
  getCacheKey: () => 'upstream-key',
};
