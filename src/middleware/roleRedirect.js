const roleRedirect = (req, res, next) => {
  return res.redirect(`${config.baseURL}/dashboard`);
};

module.exports = roleRedirect;
