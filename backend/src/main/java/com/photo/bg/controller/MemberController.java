package com.photo.bg.controller;

import com.photo.bg.common.Result;
import com.photo.bg.service.MemberSessionService;
import com.photo.bg.service.MembershipService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/member")
@RequiredArgsConstructor
public class MemberController {
    private final MemberSessionService sessions;
    private final MembershipService membership;
    @GetMapping("/status")
    public Result<Map<String,Object>> status(@RequestHeader(value="Authorization",required=false) String auth) {
        return Result.success(membership.status(sessions.requireUser(auth)));
    }
    @PostMapping("/orders")
    public Result<Map<String,Object>> create(@RequestHeader(value="Authorization",required=false) String auth, @RequestBody Map<String,String> body) throws Exception {
        Long userId = sessions.requireUser(auth);
        try { return Result.success(membership.createOrder(userId, body.get("code"))); }
        catch (IllegalArgumentException | IllegalStateException e) { return Result.error(400,e.getMessage()); }
    }
    @GetMapping("/orders/{id}")
    public Result<Map<String,Object>> query(@RequestHeader(value="Authorization",required=false) String auth, @PathVariable String id) {
        Long userId = sessions.requireUser(auth);
        try { return Result.success(membership.queryOwnOrder(userId,id)); }
        catch (IllegalArgumentException e) { return Result.error(404,"订单不存在"); }
        catch (IllegalStateException e) { return Result.error(503,e.getMessage()); }
    }
}
