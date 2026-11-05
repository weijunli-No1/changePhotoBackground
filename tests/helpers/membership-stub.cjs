// Existing feature fixtures isolate background membership sync; dedicated membership
// tests use the real module and exercise authentication and ad rendering gates.
module.exports = {
  invalidate() {},
  refresh: async () => { throw new Error('membership sync outside this fixture'); },
  open() {},
};
