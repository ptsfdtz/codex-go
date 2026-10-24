package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable internal fun CloudSettings(state:DeckState,repo:DeckRepository){
    val cloud=state.cloud
    var origin by remember(cloud.origin){mutableStateOf(cloud.origin.ifBlank{"https://agent.ptsfdtz.top"})}
    var username by remember(cloud.username){mutableStateOf(cloud.username)}
    // Passwords deliberately do not participate in saved instance state.
    var password by remember{mutableStateOf("")}
    var old by remember{mutableStateOf("")}
    var new by remember{mutableStateOf("")}
    var confirm by remember{mutableStateOf("")}
    var changing by remember{mutableStateOf(false)}
    OutlinedCard{Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
        Text("云端账户",fontWeight=FontWeight.SemiBold)
        if(!cloud.signedIn){
            Text("使用普通账户登录；网页管理后台使用管理员账户。局域网配对无需登录或互联网。",style=MaterialTheme.typography.bodySmall)
            OutlinedTextField(origin,{origin=it.take(2048)},label={Text("服务器 HTTPS 地址")},singleLine=true,enabled=!state.busy,modifier=Modifier.fillMaxWidth())
            OutlinedTextField(username,{username=it.take(80)},label={Text("用户名")},singleLine=true,enabled=!state.busy,modifier=Modifier.fillMaxWidth())
            OutlinedTextField(password,{password=it.take(1024)},label={Text("密码")},visualTransformation=PasswordVisualTransformation(),singleLine=true,enabled=!state.busy,modifier=Modifier.fillMaxWidth())
            Button(onClick={val value=password;password="";repo.cloudLogin(origin,username,value)},enabled=!state.busy&&origin.isNotBlank()&&username.isNotBlank()&&password.isNotBlank()){Text("登录")}
        }else{
            Text("${cloud.username} · ${cloud.origin}")
            if(cloud.mustChangePassword)Text("请先修改初始密码")
            if(changing||cloud.mustChangePassword){
                OutlinedTextField(old,{old=it.take(1024)},label={Text("原密码")},visualTransformation=PasswordVisualTransformation(),singleLine=true,modifier=Modifier.fillMaxWidth())
                OutlinedTextField(new,{new=it.take(1024)},label={Text("新密码（至少 12 字节）")},visualTransformation=PasswordVisualTransformation(),singleLine=true,modifier=Modifier.fillMaxWidth())
                OutlinedTextField(confirm,{confirm=it.take(1024)},label={Text("再次输入新密码")},visualTransformation=PasswordVisualTransformation(),singleLine=true,modifier=Modifier.fillMaxWidth())
                Button(onClick={val oldValue=old;val newValue=new;old="";new="";confirm="";repo.cloudPassword(oldValue,newValue)},enabled=!state.busy&&new.toByteArray().size in 12..1024&&new==confirm&&old.isNotEmpty()){Text("修改密码并重新登录")}
            }
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                if(!cloud.mustChangePassword)TextButton(onClick={changing=!changing},enabled=!state.busy){Text("修改密码")}
                TextButton(onClick=repo::cloudLogout,enabled=!state.busy){Text("退出账户")}
            }
            if(!cloud.mustChangePassword){
                Text("账户下的电脑",fontWeight=FontWeight.SemiBold)
                if(cloud.computers.isEmpty())Text("暂未绑定电脑，请在桌面端登录此账户。")
                cloud.computers.forEach{computer->
                    val host=state.hosts.find{it.hostId==computer.hostId}
                    val pairing=when{
                        host?.cloud!=null&&host.cloud==cloud.binding->"已云端配对"
                        host!=null->"仅局域网配对，需重新扫描公网配对码"
                        else->"需扫描桌面公网配对码"
                    }
                    Text("${computer.displayName} · ${if(computer.online)"在线"else"离线"} · $pairing")
                }
                TextButton(onClick=repo::cloudRefresh,enabled=!state.busy){Text("刷新电脑列表")}
            }
        }
        cloud.error?.let{Text(it,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)}
    }}
}

@Composable internal fun RouteSettings(state:DeckState,repo:DeckRepository,onPair:()->Unit){
    val host=state.host?:return
    Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
        Text("${host.label} · 连接方式",fontWeight=FontWeight.SemiBold)
        if(host.cloud==null){
            Text("此电脑仅完成局域网配对。请在桌面端登录同一云端账户，重新生成公网配对码并扫码，完成后即可选择仅云端。",style=MaterialTheme.typography.bodySmall)
            TextButton(onClick=onPair,enabled=!state.busy){Text("扫描公网配对码")}
        }
        listOf("auto" to "自动：局域网优先，云端备用","lan" to "仅局域网","cloud" to "仅云端").forEach{(value,label)->
            Row(Modifier.fillMaxWidth()){
                RadioButton(selected=host.routePolicy==value,onClick={repo.setRoutePolicy(host.hostId,value)},enabled=!state.busy&&(value!="cloud"||host.cloud!=null))
                TextButton(onClick={repo.setRoutePolicy(host.hostId,value)},enabled=!state.busy&&(value!="cloud"||host.cloud!=null)){Text(label)}
            }
        }
    }
}
