package dev.agentdeck.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UserErrorsTest {
    @Test fun codexOverloadFailureKeepsDesktopDiagnostic(){
        val message="stream disconnected before completion: Our servers are currently overloaded. Please try again later."
        val text=userFacingError("other",message)
        assertTrue(text.contains("Codex 服务暂时过载"))
        assertTrue(text.contains(message))
        assertFalse(text.contains("原始诊断信息已隐藏"))
    }

    @Test fun unknownErrorKeepsRawMessageInsteadOfHidingIt(){
        val message="Bridge 返回了未识别的响应"
        val text=userFacingError(raw=message)
        assertTrue(text.contains("操作未完成"))
        assertTrue(text.contains(message))
        assertFalse(text.contains("原始诊断信息已隐藏"))
    }
}
