package com.photo.bg.aspect;

import com.alibaba.fastjson2.JSON;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Pointcut;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import javax.servlet.http.HttpServletRequest;

/**
 * Web 请求日志切面。
 */
@Aspect
@Component
@Slf4j
public class LogAspect {

    /**
     * 定义切点，拦截所有的 Controller 方法
     */
    @Pointcut("execution(public * com.photo.bg.controller..*.*(..))")
    public void webLog() {
    }

    /**
     * 统一打印控制层调用日志。
     *
     * @param proceedingJoinPoint 切点
     * @return 方法执行结果
     * @throws Throwable 执行异常
     */
    @Around("webLog()")
    public Object doAround(ProceedingJoinPoint proceedingJoinPoint) throws Throwable {
        long startTime = System.currentTimeMillis();
        // 接收到请求，记录请求内容
        ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        HttpServletRequest request = attributes != null ? attributes.getRequest() : null;
        boolean watermarkImage = request != null && request.getRequestURI().endsWith("/api/photo/watermark");

        if (request != null) {
            // 打印请求相关参数
            log.info("========================================== Start ==========================================");
            // 打印请求 URL
            log.info("URL            : {}", request.getRequestURL().toString());
            // 打印 Http method
            log.info("HTTP Method    : {}", request.getMethod());
            // 打印调用 controller 的全路径以及执行方法
            log.info("Class Method   : {}.{}", proceedingJoinPoint.getSignature().getDeclaringTypeName(), proceedingJoinPoint.getSignature().getName());
            // 打印请求的 IP
            log.info("IP             : {}", request.getRemoteAddr());
            // 打印请求入参（过滤 Servlet 对象和文件对象）
            Object[] args = proceedingJoinPoint.getArgs();
            Object[] arguments = new Object[args.length];
            for (int i = 0; i < args.length; i++) {
                if (args[i] instanceof javax.servlet.ServletRequest || 
                    args[i] instanceof javax.servlet.ServletResponse || 
                    args[i] instanceof org.springframework.web.multipart.MultipartFile ||
                    args[i] instanceof org.springframework.web.multipart.MultipartFile[]) {
                    continue;
                }
                arguments[i] = args[i];
            }
            try {
                log.info("Request Args   : {}", watermarkImage ? "[watermark parameters omitted]" : JSON.toJSONString(arguments));
            } catch (Exception e) {
                log.info("Request Args   : [Unserializable]");
            }
        }

        Object result;
        try {
            result = proceedingJoinPoint.proceed();
        } catch (Throwable e) {
            log.error("Exception in method {}.{}(): {}", 
                proceedingJoinPoint.getSignature().getDeclaringTypeName(),
                proceedingJoinPoint.getSignature().getName(),
                e.getMessage(), e);
            throw e;
        }

        if (request != null) {
            // 打印出参
            long endTime = System.currentTimeMillis();
            try {
                log.info("Response Args  : {}", watermarkImage ? "[image response omitted]" : JSON.toJSONString(result));
            } catch (Exception e) {
                log.info("Response Args  : [Unserializable]");
            }
            // 执行耗时
            log.info("Time-Consuming : {} ms", endTime - startTime);
            log.info("=========================================== End ===========================================");
        }

        return result;
    }
}
