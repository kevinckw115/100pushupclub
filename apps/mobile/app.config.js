const { readEnvironment } = require('./src/config/environment.ts');

module.exports = ({ config }) => {
  const environment = readEnvironment(process.env);
  if (environment.name === 'production') {
    throw new Error('Production identity and EAS ownership must be configured before release.');
  }
  return { ...config, extra: { appEnvironment: environment.name } };
};
