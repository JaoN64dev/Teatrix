const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

module.exports = {
  eq: (a, b) => a === b,

  formatDate: (date) => (date ? dateFormat.format(new Date(date)) : ''),

  // JSON seguro para <script type="application/json">.
  json: (value) => JSON.stringify(value ?? null).replace(/</g, '\\u003c'),
};
