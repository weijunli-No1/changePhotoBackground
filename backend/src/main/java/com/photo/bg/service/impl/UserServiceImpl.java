package com.photo.bg.service.impl;

import cn.binarywang.wx.miniapp.api.WxMaService;
import cn.binarywang.wx.miniapp.bean.WxMaJscode2SessionResult;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.photo.bg.entity.User;
import com.photo.bg.mapper.UserMapper;
import com.photo.bg.service.UserService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * 用户服务实现。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UserServiceImpl extends ServiceImpl<UserMapper, User> implements UserService {

    private final WxMaService wxMaService;
    private final com.photo.bg.service.MemberSessionService sessions;

    /**
     * 根据微信登录临时凭证进行登录，首次登录自动注册。
     *
     * @param code 微信登录临时凭证
     * @return 用户实体
     */
    @Override
    public User loginOrRegister(String code) {
        try {
            WxMaJscode2SessionResult session = wxMaService.getUserService().getSessionInfo(code);
            String openid = session.getOpenid();

            User user = this.getOne(new LambdaQueryWrapper<User>().eq(User::getOpenid, openid));
            if (user == null) {
                user = new User();
                user.setOpenid(openid);
                user.setCreateTime(LocalDateTime.now());
                this.save(user);
            }
            user.setSessionToken(sessions.issue(user.getId()));
            return user;
        } catch (Exception e) {
            log.error("微信登录失败", e);
            throw new RuntimeException("微信鉴权失败");
        }
    }
}
