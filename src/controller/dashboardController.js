const dashboard = (req, res) => {
  res.status(200).json({
    message: `Welcome to the ${req.user.role} Dashboard`, // Different messages for roles
    user: req.user,
  });
};

module.exports = { dashboard };
