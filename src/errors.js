'use strict';

class AppError extends Error {
  constructor(code, message, status) {
    super(message || code);
    this.name = 'AppError';
    this.code = code;
    this.status = status || 400;
  }
}

const E = {
  invalid(message) {
    return new AppError('INVALID_INPUT', message, 400);
  },
  unauthorized(message) {
    return new AppError('UNAUTHORIZED', message || '需要管理员登录', 401);
  },
  invalidCredentials() {
    return new AppError('INVALID_CREDENTIALS', '用户名或口令错误', 401);
  },
  tooManyAttempts() {
    return new AppError('TOO_MANY_ATTEMPTS', '尝试次数过多，请稍后再试', 429);
  },
  notFound(message) {
    return new AppError('NOT_FOUND', message || '资源不存在', 404);
  },
  conflict(message) {
    return new AppError('CONFLICT', message || '资源冲突', 409);
  },
  forbidden(message) {
    return new AppError('FORBIDDEN', message || '请求被拒绝', 403);
  },
  internal(message) {
    return new AppError('INTERNAL_ERROR', message || '服务器内部错误', 500);
  }
};

/** 包装 async 路由，把异常交给统一错误处理中间件 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { AppError, E, asyncHandler };
