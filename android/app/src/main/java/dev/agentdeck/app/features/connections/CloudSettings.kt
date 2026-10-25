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
    val origin=cloud.origin.ifBlank{"https://agent.ptsfdtz.top"}
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
            Text("在电脑端和这里登录同一账户，即可直接使用电脑。连接方式自动选择。",style=MaterialTheme.typography.bodySmall)
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
                    Text("${computer.displayName} · ${if(computer.online)"在线"else"离线"}")
                }
                TextButton(onClick=repo::cloudRefresh,enabled=!state.busy){Text("刷新电脑列表")}
            }
        }
        cloud.error?.let{Text(it,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)}
    }}
}

@Composable internal fun RouteSettings(state:DeckState,repo:DeckRepository,onPair:()->Unit){Text("自动选择局域网或公网，无需手动设置。",style=MaterialTheme.typography.bodySmall)}
