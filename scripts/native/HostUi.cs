using System;
using System.IO;
using System.Drawing;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Threading;
using System.Linq;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class HostUi : Form {
    private static readonly Color Ink=Color.FromArgb(31,35,40), Muted=Color.FromArgb(105,112,123), Line=Color.FromArgb(228,231,235), Canvas=Color.FromArgb(247,248,250), Accent=Color.FromArgb(42,78,113);
    private readonly JavaScriptSerializer json=new JavaScriptSerializer { MaxJsonLength=2097152, RecursionLimit=80 };
    private readonly ConcurrentQueue<string> inbox=new ConcurrentQueue<string>();
    private readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer();
    private readonly NotifyIcon tray=new NotifyIcon();
    private readonly TableLayoutPanel shell=Grid(2,1), body=Grid(1,4);
    private readonly Panel pages=new Panel();
    private readonly Label heading=LabelOf("连接你的平板",23,true), subtitle=LabelOf("安全配对一次，在平板上继续使用 Codex。",10,false), hostStatus=LabelOf("正在启动",10,true), hostEndpoint=LabelOf("等待 Bridge",9,false);
    private readonly Label notice=LabelOf("",10,false), pendingNotice=LabelOf("",10,true);
    private readonly Panel noticeBar=new Panel(), pendingBar=new Panel();
    private readonly Dictionary<string,Panel> pageMap=new Dictionary<string,Panel>();
    private readonly Dictionary<string,Button> nav=new Dictionary<string,Button>();
    private readonly ListView projects=ListOf("项目列表"), devices=ListOf("已配对设备"), approvals=ListOf("待审批请求");
    private readonly ComboBox address=new ComboBox();
    private readonly PictureBox qr=new PictureBox();
    private readonly Label qrEmpty=LabelOf("二维码将显示在这里",11,false), qrStatus=LabelOf("尚未生成配对邀请",11,true), pairEndpoint=LabelOf("",10,false);
    private readonly TextBox fingerprint=ReadBox("证书指纹",true), projectPath=ReadBox("项目完整路径",true), deviceInfo=ReadBox("设备详情",true), approvalInfo=ReadBox("审批关联信息",true);
    private readonly RichTextBox approvalContext=new RichTextBox();
    private readonly Label projectHint=LabelOf("选择项目，查看完整路径。",10,false), deviceHint=LabelOf("尚未选择设备",12,true), approvalTitle=LabelOf("没有待处理审批",14,true), approvalTime=LabelOf("",10,false);
    private Button createQr, copyQr, removeProject, revokeDevice, allow, reject;
    private string currentPage="pair", invitationJson, endpoint="", submittedApproval, lastApprovalSignature="";
    private DateTimeOffset invitationExpires;
    private bool exiting, disconnected, updating, modalOpen, didInitialNavigation, pairCreating;
    private readonly bool verifyState;
    private readonly ImageList rowImages=new ImageList();
    private Font navRegular, navBold;
    private Button syncWorkspaces, backHome;
    private readonly Label workspaceSummary=LabelOf("尚未同步工作区",11,true), workspaceHint=LabelOf("同步后可在平板切换项目",9,false), connectionSummary=LabelOf("",10,false);
    private bool syncing;
    private int previousApprovalCount;

    private static TableLayoutPanel Grid(int cols,int rows){var grid=new TableLayoutPanel {ColumnCount=cols,RowCount=rows,Dock=DockStyle.Fill,Margin=Padding.Empty,Padding=Padding.Empty,BackColor=Color.Transparent};for(int i=0;i<cols;i++)grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100f/cols));return grid;}
    private static Label LabelOf(string text,float size,bool bold){return new Label {Text=text,AutoSize=false,ForeColor=bold?Ink:Muted,Font=new Font("Microsoft YaHei UI",size,bold?FontStyle.Bold:FontStyle.Regular),Dock=DockStyle.Fill,TextAlign=ContentAlignment.MiddleLeft,Margin=Padding.Empty,AutoEllipsis=true};}
    private static TextBox ReadBox(string name,bool multi){return new TextBox {AccessibleName=name,Multiline=multi,ReadOnly=true,BorderStyle=BorderStyle.None,BackColor=Color.White,ForeColor=Ink,Dock=DockStyle.Fill,ScrollBars=multi?ScrollBars.Vertical:ScrollBars.None,Font=new Font("Microsoft YaHei UI",10),Margin=new Padding(0,8,0,8)};}
    private static ListView ListOf(string name){return new ListView {AccessibleName=name,Dock=DockStyle.Fill,View=View.Details,FullRowSelect=true,HideSelection=false,MultiSelect=false,BorderStyle=BorderStyle.None,BackColor=Color.White,ForeColor=Ink,Font=new Font("Microsoft YaHei UI",10),HeaderStyle=ColumnHeaderStyle.Nonclickable,Margin=Padding.Empty};}
    private static Button ButtonOf(string text,Action action,bool primary){
        Button b=new Button {Text=text,AccessibleName=text,AutoSize=true,AutoSizeMode=AutoSizeMode.GrowAndShrink,MinimumSize=new Size(100,38),Padding=new Padding(14,5,14,5),Margin=new Padding(0,0,10,0),FlatStyle=FlatStyle.Flat,BackColor=primary?Ink:Color.White,ForeColor=primary?Color.White:Ink,Cursor=Cursors.Hand,UseVisualStyleBackColor=false};
        b.FlatAppearance.BorderColor=primary?Ink:Line;b.FlatAppearance.MouseOverBackColor=primary?Color.FromArgb(60,65,72):Canvas;b.Click+=delegate{action();};return b;
    }
    private static FlowLayoutPanel Actions(params Control[] controls){FlowLayoutPanel flow=new FlowLayoutPanel {Dock=DockStyle.Fill,FlowDirection=FlowDirection.LeftToRight,WrapContents=false,Margin=Padding.Empty};flow.Controls.AddRange(controls);return flow;}
    private static Panel Card(Control content){Panel p=new Panel {Dock=DockStyle.Fill,BackColor=Color.White,Padding=new Padding(20),Margin=new Padding(0,0,0,16)};p.Controls.Add(content);p.Paint+=delegate(object s,PaintEventArgs e){using(Pen pen=new Pen(Line))e.Graphics.DrawRectangle(pen,0,0,p.Width-1,p.Height-1);};return p;}
    private static void Row(TableLayoutPanel table,int row,Control control,float height){table.RowStyles.Add(height<0?new RowStyle(SizeType.Percent,-height):new RowStyle(SizeType.Absolute,height));table.Controls.Add(control,0,row);}
    private static string S(Dictionary<string,object> value,string key){object v;return value!=null&&value.TryGetValue(key,out v)&&v!=null?Convert.ToString(v,CultureInfo.InvariantCulture):"";}
    private static object V(Dictionary<string,object> value,string key,object fallback){object v;return value!=null&&value.TryGetValue(key,out v)&&v!=null?v:fallback;}
    private static Dictionary<string,object> Selected(ListView list){return list.SelectedItems.Count==1?list.SelectedItems[0].Tag as Dictionary<string,object>:null;}
    private void Emit(object value){Console.Out.WriteLine(json.Serialize(value));Console.Out.Flush();}
    private void Reveal(){Show();WindowState=FormWindowState.Normal;Activate();}
    private void Banner(string text,bool error){notice.Text=text;notice.ForeColor=error?Color.FromArgb(156,45,45):Accent;noticeBar.BackColor=error?Color.FromArgb(255,241,240):Color.FromArgb(238,244,250);body.RowStyles[1].Height=String.IsNullOrEmpty(text)?0:48;noticeBar.Visible=!String.IsNullOrEmpty(text);}
    private void Navigate(string key){currentPage=key;foreach(var item in pageMap)item.Value.Visible=item.Key==key;foreach(var item in nav){item.Value.BackColor=item.Key==key?Color.FromArgb(229,234,240):Canvas;item.Value.Font=item.Key==key?navBold:navRegular;}string[] names=key=="pair"?new[]{"连接你的平板","选择本机地址，扫码并确认。配对后可直接开始对话。"}:key=="projects"?new[]{"项目工作区","只有在这台电脑上授权的项目，才会出现在平板中。"}:key=="approvals"?new[]{"审批中心","检查完整操作，再决定是否允许。每个请求只处理一次。"}:new[]{"设备管理","管理已经配对的平板；撤销后将立即断开连接。"};heading.Text=names[0];subtitle.Text=names[1];if(backHome!=null)backHome.Visible=key!="pair";}
    private void AddPage(string key,Control content){Panel p=new Panel {Dock=DockStyle.Fill,Visible=false,BackColor=Canvas,AutoScroll=true};p.Controls.Add(content);if(key=="pair")content.MinimumSize=new Size(0,408);pages.Controls.Add(p);pageMap.Add(key,p);}

    private HostUi(bool verify){
        verifyState=verify;Text="AgentDeck";Font=new Font("Microsoft YaHei UI",10);ForeColor=Ink;BackColor=Canvas;AutoScaleMode=AutoScaleMode.Dpi;AutoScaleDimensions=new SizeF(96,96);FormBorderStyle=FormBorderStyle.None;MinimumSize=new Size(700,560);ClientSize=new Size(780,620);StartPosition=FormStartPosition.CenterScreen;DoubleBuffered=true;
        navRegular=new Font(Font,FontStyle.Regular);navBold=new Font(Font,FontStyle.Bold);
        shell.RowStyles.Add(new RowStyle(SizeType.Percent,100));shell.ColumnCount=1;shell.ColumnStyles.Clear();shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));Controls.Add(shell);body.Padding=new Padding(28,12,28,20);shell.Controls.Add(body,0,0);
        TableLayoutPanel header=Grid(2,1);header.RowStyles.Add(new RowStyle(SizeType.Percent,100));header.ColumnStyles.Clear();header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,188));
        Label brand=LabelOf("AgentDeck",16,true);brand.MouseDown+=DragWindow;header.MouseDown+=DragWindow;header.Controls.Add(brand,0,0);
        ContextMenuStrip more=new ContextMenuStrip();more.Items.Add("项目与同步范围",null,delegate{Navigate("projects");});more.Items.Add("设备管理",null,delegate{Navigate("devices");});more.Items.Add("待审批",null,delegate{Navigate("approvals");});more.Items.Add("网络与配对信息",null,delegate{ShowConnectionDetails();});more.Items.Add("停止并退出",null,delegate{if(Confirm("停止 AgentDeck？","平板将断开连接。","停止并退出",true))Emit(new{action="stop"});});
        Button menu=ChromeButton("···","更多",delegate{more.Show(Cursor.Position);}), min=ChromeButton("−","最小化",delegate{WindowState=FormWindowState.Minimized;}), close=ChromeButton("×","收起到托盘",delegate{Hide();});
        backHome=ChromeButton("‹","返回首页",delegate{Navigate("pair");});backHome.Visible=false;
        header.Controls.Add(Actions(backHome,menu,min,close),1,0);Row(body,0,header,52);
        noticeBar.Dock=DockStyle.Fill;noticeBar.Padding=new Padding(10,0,4,0);Button closeNotice=ChromeButton("×","关闭提示",delegate{Banner("",false);});closeNotice.Dock=DockStyle.Right;noticeBar.Controls.Add(notice);noticeBar.Controls.Add(closeNotice);Row(body,1,noticeBar,0);noticeBar.Visible=false;
        pendingBar.Dock=DockStyle.Fill;pendingBar.BackColor=Color.FromArgb(255,247,228);pendingBar.Padding=new Padding(10,0,4,0);Button showPending=ButtonOf("查看",delegate{Navigate("approvals");},false);showPending.Dock=DockStyle.Right;pendingBar.Controls.Add(pendingNotice);pendingBar.Controls.Add(showPending);Row(body,2,pendingBar,0);pendingBar.Visible=false;pages.Dock=DockStyle.Fill;Row(body,3,pages,-100);
        foreach(string key in new[]{"pair","projects","approvals","devices"})nav.Add(key,new Button());
        rowImages.ImageSize=new Size(1,32);foreach(var list in new[]{projects,devices,approvals})list.SmallImageList=rowImages;
        BuildPairPage();BuildProjectsPage();BuildApprovalPage();BuildDevicesPage();Navigate("pair");
        tray.Icon=SystemIcons.Application;tray.Text="AgentDeck";tray.Visible=true;ContextMenuStrip trayMenu=new ContextMenuStrip();trayMenu.Items.Add("打开 AgentDeck",null,delegate{Navigate("pair");Reveal();});trayMenu.Items.Add("查看待审批",null,delegate{Navigate("approvals");Reveal();});trayMenu.Items.Add("停止并退出",null,delegate{if(Confirm("停止 AgentDeck？","平板将断开连接。","停止并退出",true))Emit(new{action="stop"});});tray.ContextMenuStrip=trayMenu;tray.DoubleClick+=delegate{Reveal();};
        FormClosing+=delegate(object sender,FormClosingEventArgs e){if(!exiting){e.Cancel=true;Hide();}};
        Thread reader=new Thread(delegate(){try{string line;while((line=Console.In.ReadLine())!=null){if(line.Length>2097152||inbox.Count>64)break;inbox.Enqueue(line);}}catch{}finally{disconnected=true;}});reader.IsBackground=true;reader.Start();
        timer.Interval=150;timer.Tick+=delegate{string line;for(int i=0;i<8&&inbox.TryDequeue(out line);i++){try{HandleMessage(line);}catch(Exception error){Banner("窗口数据暂不可用，请检查 Bridge 的脱敏诊断。",true);Console.Error.WriteLine(error.GetType().Name);if(verifyState)Environment.ExitCode=1;}}TickExpiry();if(disconnected&&inbox.IsEmpty){exiting=true;Close();}};timer.Start();
    }
    private static Button ChromeButton(string text,string name,Action action){Button b=ButtonOf(text,action,false);b.AccessibleName=name;b.AutoSize=false;b.MinimumSize=new Size(36,34);b.Size=new Size(36,34);b.Padding=Padding.Empty;b.Margin=new Padding(2,0,2,0);b.FlatAppearance.BorderSize=0;b.BackColor=Canvas;b.Font=new Font("Microsoft YaHei UI",15);return b;}
    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd,int msg,IntPtr wParam,IntPtr lParam);
    private void DragWindow(object sender,MouseEventArgs e){if(e.Button==MouseButtons.Left){ReleaseCapture();SendMessage(Handle,0xA1,new IntPtr(2),IntPtr.Zero);}}
    protected override void WndProc(ref Message m){base.WndProc(ref m);if(m.Msg==0x84&&m.Result.ToInt32()==1){Point point=PointToClient(new Point((short)(m.LParam.ToInt64()&0xffff),(short)((m.LParam.ToInt64()>>16)&0xffff)));int edge=7;bool l=point.X<edge,r=point.X>=Width-edge,t=point.Y<edge,b=point.Y>=Height-edge;m.Result=new IntPtr(t?(l?13:r?14:12):b?(l?16:r?17:15):l?10:r?11:1);}}
    private void ShowConnectionDetails(){modalOpen=true;try{using(Form d=new Form {Text="连接信息",Font=Font,BackColor=Color.White,Size=new Size(620,380),StartPosition=FormStartPosition.CenterParent,FormBorderStyle=FormBorderStyle.None,ShowInTaskbar=false,AutoScaleMode=AutoScaleMode.Dpi,AutoScaleDimensions=new SizeF(96,96)}){TableLayoutPanel layout=Grid(1,5);layout.Padding=new Padding(24);d.Controls.Add(layout);Label title=LabelOf("连接信息",16,true);title.MouseDown+=delegate(object sender,MouseEventArgs e){if(e.Button==MouseButtons.Left){ReleaseCapture();SendMessage(d.Handle,0xA1,new IntPtr(2),IntPtr.Zero);}};Row(layout,0,title,42);Row(layout,1,address,42);Row(layout,2,fingerprint,-100);Row(layout,3,Actions(copyQr),44);Button done=ButtonOf("完成",delegate{d.Close();},true);Row(layout,4,Actions(done),44);d.CancelButton=done;d.FormClosing+=delegate{layout.Controls.Remove(address);layout.Controls.Remove(fingerprint);if(copyQr.Parent!=null)copyQr.Parent.Controls.Remove(copyQr);};d.ShowDialog(this);layout.Controls.Remove(address);layout.Controls.Remove(fingerprint);if(copyQr.Parent!=null)copyQr.Parent.Controls.Remove(copyQr);}}finally{modalOpen=false;}}
    private void BuildPairPage(){
        TableLayoutPanel content=Grid(1,3);
        TableLayoutPanel sync=Grid(2,1);sync.RowStyles.Add(new RowStyle(SizeType.Percent,100));sync.ColumnStyles.Clear();sync.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));sync.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,220));TableLayoutPanel summary=Grid(1,2);Row(summary,0,workspaceSummary,30);Row(summary,1,workspaceHint,30);sync.Controls.Add(summary,0,0);
        syncWorkspaces=ButtonOf("同步 Codex 工作区",delegate{if(!syncing){syncing=true;syncWorkspaces.Enabled=false;syncWorkspaces.Text="正在同步…";Emit(new{action="workspaces.sync"});}},true);syncWorkspaces.Dock=DockStyle.Fill;syncWorkspaces.Margin=new Padding(0,8,0,8);sync.Controls.Add(syncWorkspaces,1,0);Row(content,0,Card(sync),132);
        TableLayoutPanel pair=Grid(2,1);pair.RowStyles.Add(new RowStyle(SizeType.Percent,100));pair.ColumnStyles.Clear();pair.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,276));pair.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));Panel qrPanel=new Panel {Dock=DockStyle.Fill,BackColor=Color.White,Margin=new Padding(0,0,22,0)};qr.Dock=DockStyle.Fill;qr.SizeMode=PictureBoxSizeMode.Zoom;qr.AccessibleName="配对二维码";qrPanel.Controls.Add(qr);qrEmpty.Text="同步工作区后\r\n显示配对二维码";qrEmpty.TextAlign=ContentAlignment.MiddleCenter;qrPanel.Controls.Add(qrEmpty);qrEmpty.BringToFront();pair.Controls.Add(qrPanel,0,0);
        TableLayoutPanel guide=Grid(1,5);Row(guide,0,LabelOf("扫码，在平板继续",18,true),52);Row(guide,1,LabelOf("打开平板 AgentDeck 扫码，\r\n核对配对码后即可连接。",10,false),64);Row(guide,2,qrStatus,40);Row(guide,3,connectionSummary,-100);
        createQr=ButtonOf("显示配对码",delegate{if(address.SelectedItem!=null){pairCreating=true;createQr.Enabled=false;Emit(new{action="pair.create",address=address.SelectedItem.ToString()});}},false);Row(guide,4,Actions(createQr),44);pair.Controls.Add(guide,1,0);Row(content,1,Card(pair),-100);
        Row(content,2,LabelOf("同步会授权 Codex 本机项目并开启局域网配对；命令与文件审批仍需确认。",9,false),34);
        address.DropDownStyle=ComboBoxStyle.DropDownList;address.AccessibleName="本机连接地址";address.Dock=DockStyle.Fill;address.FormattingEnabled=true;address.Format+=delegate(object sender,ListControlConvertEventArgs e){string a=Convert.ToString(e.ListItem);e.Value=a+(a=="127.0.0.1"?" · 仅本机":" · 局域网");};
        fingerprint.Font=new Font("Consolas",9);copyQr=ButtonOf("复制配对信息",delegate{if(invitationJson!=null&&DateTimeOffset.UtcNow<invitationExpires){Clipboard.SetText(invitationJson);Banner("已复制配对信息。",false);}},false);copyQr.Enabled=false;AddPage("pair",content);
    }
    private void BuildProjectsPage(){
        TableLayoutPanel content=Grid(1,3);Button add=ButtonOf("添加项目…",AddFolder,true);removeProject=ButtonOf("移除授权",RemoveProject,false);removeProject.Enabled=false;Row(content,0,Actions(add,removeProject,ButtonOf("复制路径",delegate{var e=Selected(projects);if(e!=null&&!String.IsNullOrEmpty(S(e,"canonicalPath"))){Clipboard.SetText(S(e,"canonicalPath"));Banner("已复制项目完整路径。",false);}},false)),52);
        projects.Columns.Add("项目名称",200);projects.Columns.Add("授权路径",460);projects.Columns.Add("状态",90);projects.SelectedIndexChanged+=delegate{if(!updating)UpdateProject();};projects.SizeChanged+=delegate{FitColumns(projects,new[]{25,61,14});};Row(content,1,Card(projects),-100);
        TableLayoutPanel info=Grid(1,3);Row(info,0,projectHint,30);Row(info,1,projectPath,-100);Row(info,2,LabelOf("授权后 Codex 可在工作区内修改文件；额外权限仍需人工确认。",9,false),28);Row(content,2,Card(info),154);AddPage("projects",content);
    }
    private void BuildDevicesPage(){
        TableLayoutPanel content=Grid(1,3);revokeDevice=ButtonOf("撤销所选设备",delegate{var e=Selected(devices);if(e!=null&&Confirm("撤销这个设备？",S(e,"displayName")+"\r\n撤销后会立即断开，重新连接需要再次配对。","撤销设备",true))Emit(new{action="device.revoke",deviceId=S(e,"deviceId")});},false);revokeDevice.Enabled=false;Row(content,0,Actions(ButtonOf("配对新设备",delegate{Navigate("pair");},true),revokeDevice),52);
        devices.Columns.Add("设备",250);devices.Columns.Add("配对时间",230);devices.Columns.Add("连接",100);devices.SelectedIndexChanged+=delegate{if(!updating)UpdateDevice();};devices.SizeChanged+=delegate{FitColumns(devices,new[]{42,36,22});};Row(content,1,Card(devices),-100);
        TableLayoutPanel info=Grid(1,3);Row(info,0,deviceHint,30);Row(info,1,deviceInfo,-100);Row(info,2,LabelOf("当前版本支持一台已配对设备，新配对会替换旧设备。",9,false),28);Row(content,2,Card(info),200);AddPage("devices",content);
    }
    private void BuildApprovalPage(){
        TableLayoutPanel content=Grid(1,2);approvals.Columns.Add("请求操作",180);approvals.Columns.Add("项目 / 会话",290);approvals.Columns.Add("有效至",140);approvals.SizeChanged+=delegate{FitColumns(approvals,new[]{27,48,25});};approvals.SelectedIndexChanged+=delegate{if(!updating)UpdateApproval();};Row(content,0,Card(approvals),142);
        TableLayoutPanel detail=Grid(1,5);Row(detail,0,approvalTitle,34);Row(detail,1,approvalInfo,54);approvalContext.ReadOnly=true;approvalContext.DetectUrls=false;approvalContext.WordWrap=false;approvalContext.BorderStyle=BorderStyle.None;approvalContext.BackColor=Canvas;approvalContext.ForeColor=Ink;approvalContext.Font=new Font("Consolas",10);approvalContext.Dock=DockStyle.Fill;approvalContext.AccessibleName="完整审批操作";approvalContext.Text="请求到达后，在这里检查完整命令、目录和权限范围。";Row(detail,2,approvalContext,-100);Row(detail,3,approvalTime,32);
        reject=ButtonOf("拒绝此请求",delegate{Decide("reject");},false);allow=ButtonOf("允许一次…",delegate{Decide("approve");},true);allow.Enabled=reject.Enabled=false;Row(detail,4,Actions(reject,allow),44);Row(content,1,Card(detail),-100);AddPage("approvals",content);
    }
    private static void FitColumns(ListView list,int[] ratios){int available=Math.Max(80,list.ClientSize.Width-22);for(int i=0;i<ratios.Length;i++)list.Columns[i].Width=available*ratios[i]/100;}
    private string DateLabel(string raw){DateTimeOffset date;return DateTimeOffset.TryParse(raw,out date)?date.ToLocalTime().ToString("MM-dd HH:mm:ss"):raw;}
    private void Entries(ListView list,object value,string key,Func<Dictionary<string,object>,string[]> columns){
        var values=((IEnumerable)value).Cast<object>().Select(v=>(Dictionary<string,object>)v).ToArray();string signature=json.Serialize(values);if(Convert.ToString(list.Tag)==signature)return;
        string selected=S(Selected(list),key);int scroll=list.TopItem==null?0:list.TopItem.Index;updating=true;list.BeginUpdate();try{list.Items.Clear();foreach(var row in values){ListViewItem item=new ListViewItem(columns(row));item.Tag=row;list.Items.Add(item);if(S(row,key)==selected)item.Selected=true;}if(list.Items.Count>0&&list.SelectedItems.Count==0)list.Items[0].Selected=true;if(list.Items.Count>scroll)list.TopItem=list.Items[scroll];list.Tag=signature;}finally{list.EndUpdate();updating=false;}
    }
    private void UpdateProject(){var e=Selected(projects);removeProject.Enabled=e!=null;projectHint.Text=e==null?(projects.Items.Count==0?"还没有项目，点击“添加项目”选择本机目录。":"选择项目，查看完整路径。"):S(e,"name");projectPath.Text=S(e,"canonicalPath");}
    private void UpdateDevice(){var e=Selected(devices);revokeDevice.Enabled=e!=null;deviceHint.Text=e==null?"还没有已配对设备":S(e,"displayName");deviceInfo.Text=e==null?"配对后，平板会显示在这里。":"设备 ID  "+S(e,"deviceId")+"\r\n配对时间  "+DateLabel(S(e,"createdAt"))+"\r\n"+(e.ContainsKey("connected")?(Convert.ToBoolean(e["connected"])?"当前已连接":"当前未连接"):"已授权 · 连接状态暂不可用");}
    private string Pretty(object value,int depth){
        if(depth>20)return json.Serialize(value);
        string indent=new string(' ',depth*2),next=indent+"  ";var obj=value as Dictionary<string,object>;
        if(obj!=null)return "{\r\n"+String.Join(",\r\n",obj.Select(k=>next+json.Serialize(k.Key)+": "+Pretty(k.Value,depth+1)))+"\r\n"+indent+"}";
        var array=value as IEnumerable;if(array!=null&&!(value is string))return "[\r\n"+String.Join(",\r\n",array.Cast<object>().Select(v=>next+Pretty(v,depth+1)))+"\r\n"+indent+"]";
        return json.Serialize(value);
    }
    private void UpdateApproval(){
        var e=Selected(approvals);string signature=e==null?"":json.Serialize(e);if(signature!=lastApprovalSignature){lastApprovalSignature=signature;approvalTitle.Text=e==null?"没有待处理审批":ApprovalKind(S(e,"method"));approvalInfo.Text=e==null?"所有请求都需人工决定，没有默认自动批准。":"项目 / 会话  "+S(e,"sessionTitle")+"\r\n会话 ID  "+S(e,"sessionId")+"   回合  "+S(e,"turnId");approvalContext.Text=e==null?"请求到达后，在这里检查完整命令、目录和权限范围。":Pretty(V(e,"context",new Dictionary<string,object>()),0);}
        DateTimeOffset expires;bool valid=e!=null&&DateTimeOffset.TryParse(S(e,"expiresAt"),out expires)&&expires>DateTimeOffset.UtcNow&&S(e,"status")=="pending"&&S(e,"approvalId")!=submittedApproval;
        bool offers=e!=null&&((IEnumerable)V(e,"allowedDecisions",new object[0])).Cast<object>().Any(v=>Convert.ToString(v)=="approve");allow.Enabled=valid&&offers;reject.Enabled=valid;
        approvalTime.Text=e==null?"":S(e,"approvalId")==submittedApproval?"决定已提交，正在等待 Bridge 确认…":!valid?"请求已过期或不可处理":"有效至 "+DateLabel(S(e,"expiresAt"))+" · 允许仅对本次操作生效";
    }
    private static string ApprovalKind(string method){return method.IndexOf("commandExecution",StringComparison.Ordinal)>=0?"执行命令":method.IndexOf("fileChange",StringComparison.Ordinal)>=0?"修改文件":"额外权限请求";}
    private void Decide(string decision){
        var e=Selected(approvals);if(e==null||!(decision=="approve"?allow.Enabled:reject.Enabled))return;
        string id=S(e,"approvalId"), context=Pretty(V(e,"context",new Dictionary<string,object>()),0);
        if(!Confirm(decision=="approve"?"允许这一次操作？":"拒绝这次请求？",context,decision=="approve"?"允许一次":"拒绝请求",true))return;
        var latest=approvals.Items.Cast<ListViewItem>().Select(i=>i.Tag as Dictionary<string,object>).FirstOrDefault(v=>S(v,"approvalId")==id);DateTimeOffset expires;
        if(latest==null||!DateTimeOffset.TryParse(S(latest,"expiresAt"),out expires)||expires<=DateTimeOffset.UtcNow){Banner("请求已过期或已在其他设备处理，本次决定未发送。",true);return;}
        submittedApproval=id;UpdateApproval();Emit(new{action="approval.decide",approvalId=id,sessionId=S(e,"sessionId"),turnId=S(e,"turnId"),decision=decision});
    }
    private bool Confirm(string title,string text,string action,bool danger){
        modalOpen=true;try{using(Form dialog=new Form {Text=title,FormBorderStyle=FormBorderStyle.None,Font=Font,BackColor=Color.White,ForeColor=Ink,StartPosition=FormStartPosition.CenterParent,MinimizeBox=false,MaximizeBox=false,Size=new Size(680,440),MinimumSize=new Size(520,340),ShowInTaskbar=false,AutoScaleMode=AutoScaleMode.Dpi,AutoScaleDimensions=new SizeF(96,96)}){
            TableLayoutPanel layout=Grid(1,4);layout.Padding=new Padding(24);dialog.Controls.Add(layout);Row(layout,0,LabelOf(title,17,true),46);RichTextBox review=new RichTextBox {ReadOnly=true,Text=text,Dock=DockStyle.Fill,BorderStyle=BorderStyle.None,BackColor=Canvas,DetectUrls=false,Font=new Font("Consolas",10),WordWrap=false,AccessibleName="确认操作详情"};Row(layout,1,review,-100);Row(layout,2,LabelOf("请核对完整范围。取消会保留当前状态。",9,false),34);
            Button cancel=ButtonOf("取消",delegate{dialog.DialogResult=DialogResult.Cancel;},false), accept=ButtonOf(action,delegate{dialog.DialogResult=DialogResult.OK;},true);Row(layout,3,Actions(cancel,accept),44);dialog.CancelButton=cancel;dialog.AcceptButton=cancel;dialog.Shown+=delegate{cancel.Focus();};return dialog.ShowDialog(this)==DialogResult.OK;
        }}finally{modalOpen=false;}
    }
    private void AddFolder(){modalOpen=true;try{using(FolderBrowserDialog d=new FolderBrowserDialog {Description="选择允许 AgentDeck / Codex 访问的项目根目录"}){if(d.ShowDialog(this)==DialogResult.OK)Emit(new{action="project.add",path=d.SelectedPath});}}finally{modalOpen=false;}}
    private void RemoveProject(){var e=Selected(projects);if(e!=null&&Confirm("移除此项目的授权？",S(e,"name")+"\r\n"+S(e,"canonicalPath")+"\r\n不会删除磁盘上的文件。","移除授权",true))Emit(new{action="project.remove",projectId=S(e,"projectId")});}
    private void TickExpiry(){
        if(invitationJson!=null){int seconds=(int)Math.Ceiling((invitationExpires-DateTimeOffset.UtcNow).TotalSeconds);if(seconds<=0){invitationJson=null;copyQr.Enabled=false;ClearQr();qrEmpty.Text="二维码已过期\r\n点击显示配对码重新生成";qrEmpty.Visible=true;qrEmpty.BringToFront();qrStatus.Text="邀请已过期";}else qrStatus.Text="等待平板扫码 · "+seconds+" 秒后过期";}
        UpdateApproval();
    }
    private void ClearQr(){if(qr.Image!=null){Image old=qr.Image;qr.Image=null;old.Dispose();}}
    private void PairConfirmation(Dictionary<string,object> p){
        Reveal();Navigate("pair");modalOpen=true;bool approved=false;
        try{using(Form d=new Form {Text="确认配对设备",Font=Font,BackColor=Color.White,Size=new Size(550,400),StartPosition=FormStartPosition.CenterParent,MinimizeBox=false,MaximizeBox=false,FormBorderStyle=FormBorderStyle.None,ShowInTaskbar=false,AutoScaleMode=AutoScaleMode.Dpi,AutoScaleDimensions=new SizeF(96,96)}){
            TableLayoutPanel layout=Grid(1,5);layout.Padding=new Padding(28);d.Controls.Add(layout);Row(layout,0,LabelOf("确认是你的平板",18,true),44);Row(layout,1,LabelOf("设备："+S(p,"displayName"),11,false),38);Label code=LabelOf(S(p,"code"),34,true);code.TextAlign=ContentAlignment.MiddleCenter;Row(layout,2,code,-100);Row(layout,3,LabelOf("请核对两台设备的六位码完全一致，再确认配对。",10,false),50);
            Button cancel=ButtonOf("拒绝",delegate{d.DialogResult=DialogResult.Cancel;},false), accept=ButtonOf("配对码一致，确认",delegate{d.DialogResult=DialogResult.OK;},true);Row(layout,4,Actions(cancel,accept),44);d.CancelButton=cancel;d.AcceptButton=cancel;d.Shown+=delegate{cancel.Focus();};approved=d.ShowDialog(this)==DialogResult.OK;
        }}finally{modalOpen=false;}
        Emit(new{action="pair.confirm",requestId=S(p,"requestId"),approve=approved});
        invitationJson=null;copyQr.Enabled=false;ClearQr();qrEmpty.Text=approved?"正在完成配对…":"已拒绝配对\r\n请重新生成二维码";qrEmpty.Visible=true;qrEmpty.BringToFront();qrStatus.Text=approved?"正在签发设备凭据":"配对已拒绝";
    }
    private void HandleMessage(string line){
        var m=json.Deserialize<Dictionary<string,object>>(line);var p=(Dictionary<string,object>)m["payload"];
        if(modalOpen&&new[]{"pair.confirm","project.addRequest","project.removeRequest"}.Contains(S(m,"type"))){inbox.Enqueue(line);return;}
        switch(S(m,"type")){
            case "verify.layout":
                if(verifyState){float scale;using(var g=CreateGraphics())scale=g.DpiX/96f;ClientSize=new Size((int)(Convert.ToInt32(p["width"])*scale),(int)(Convert.ToInt32(p["height"])*scale));Navigate(S(p,"page"));PerformLayout();VerifyLayout();}break;
            case "verify.selectProject":
                if(verifyState){foreach(ListViewItem item in projects.Items)item.Selected=S(item.Tag as Dictionary<string,object>,"projectId")==S(p,"projectId");UpdateProject();VerifyLayout();}break;
            case "verify.inspect":if(verifyState)VerifyLayout();break;
            case "state":
                if(p.ContainsKey("windowTitle"))Text=S(p,"windowTitle");
                bool ready=p.ContainsKey("codexReady")?Convert.ToBoolean(p["codexReady"]):S(p,"status").Contains("connected to Codex");hostStatus.Text=ready?"●  Codex 已连接":"●  Codex 正在连接";hostStatus.ForeColor=ready?Color.FromArgb(40,107,82):Muted;endpoint=S(p,"endpoint");hostEndpoint.Text=String.IsNullOrEmpty(endpoint)?S(p,"status"):endpoint.Replace("https://","");if(p.ContainsKey("sandboxVerified")&&!Convert.ToBoolean(p["sandboxVerified"]))hostStatus.Text="●  正在验证工作区隔离";
                Entries(projects,V(p,"projects",new object[0]),"projectId",v=>new[]{S(v,"name"),S(v,"canonicalPath"),v.ContainsKey("enabled")&&!Convert.ToBoolean(v["enabled"])?"已停用":"已授权"});UpdateProject();
                workspaceSummary.Text=projects.Items.Count>0?projects.Items.Count+" 个项目可在平板使用":"同步你的 Codex 项目";workspaceHint.Text=String.IsNullOrEmpty(S(p,"lastWorkspaceSync"))?"一键同步本机项目目录": "上次同步 "+DateLabel(S(p,"lastWorkspaceSync"));syncWorkspaces.Enabled=!syncing&&ready;
                Entries(devices,V(p,"devices",new object[0]),"deviceId",v=>new[]{S(v,"displayName"),DateLabel(S(v,"createdAt")),v.ContainsKey("connected")?(Convert.ToBoolean(v["connected"])?"在线":"未连接"):"已配对"});UpdateDevice();connectionSummary.Text=devices.Items.Count==0?"PC 与平板连接同一局域网":devices.Items.Cast<ListViewItem>().Any(i=>Convert.ToBoolean(V(i.Tag as Dictionary<string,object>,"connected",false)))?"平板已连接 · 可直接使用":"已配对 · 等待平板连接";
                Entries(approvals,V(p,"approvals",new object[0]),"approvalId",v=>new[]{ApprovalKind(S(v,"method")),S(v,"sessionTitle").Length>0?S(v,"sessionTitle"):S(v,"sessionId"),DateLabel(S(v,"expiresAt"))});UpdateApproval();
                nav["approvals"].Text="审批中心"+(approvals.Items.Count>0?"  "+approvals.Items.Count:"");pendingNotice.Text=approvals.Items.Count+" 个请求需要你的确认";body.RowStyles[2].Height=approvals.Items.Count>0?52:0;pendingBar.Visible=approvals.Items.Count>0;
                if(approvals.Items.Count>0&&previousApprovalCount==0){if(!modalOpen){Navigate("approvals");Reveal();}tray.ShowBalloonTip(4000,"AgentDeck","有新的操作需要你确认。",ToolTipIcon.Info);}previousApprovalCount=approvals.Items.Count;
                UpdateAddresses(V(p,"addresses",new object[0]),S(p,"listenAddress"));
                if(!didInitialNavigation){didInitialNavigation=true;if(approvals.Items.Count==0)Navigate("pair");}
                if(verifyState)VerifyLayout();break;
            case "pair.qr":
                pairCreating=false;createQr.Enabled=true;ClearQr();using(var stream=new MemoryStream(Convert.FromBase64String(S(p,"image"))))using(var decoded=Image.FromStream(stream)){qr.Image=new Bitmap(decoded);}qrEmpty.Visible=false;pairEndpoint.Text=S(p,"endpoint");fingerprint.Text=S(p,"fingerprint");
                DateTimeOffset.TryParse(S(p,"expiresAt"),out invitationExpires);invitationJson=json.Serialize(p.Where(k=>k.Key!="image").ToDictionary(k=>k.Key,k=>k.Value));copyQr.Enabled=true;Navigate("pair");TickExpiry();break;
            case "pair.confirm":PairConfirmation(p);break;
            case "project.addRequest":Reveal();Navigate("projects");AddFolder();break;
            case "project.removeRequest":Reveal();Navigate("projects");foreach(ListViewItem item in projects.Items)if(S(item.Tag as Dictionary<string,object>,"projectId")==S(p,"projectId")){item.Selected=true;RemoveProject();break;}break;
            case "workspaces.synced":
                syncWorkspaces.Text="正在准备配对…";Banner("已同步 "+S(p,"synced")+" 个项目"+(S(p,"skipped")=="0"?"":"，跳过 "+S(p,"skipped")+" 个无效或临时目录")+"。可在平板切换。",false);break;
            case "action.result":
                if(S(p,"action")=="workspaces.sync"){syncing=false;syncWorkspaces.Enabled=true;syncWorkspaces.Text="再次同步";}if(S(p,"action")=="pair.create")pairCreating=false;createQr.Enabled=address.Items.Count>0&&!pairCreating;if(S(p,"action")=="approval.decide")submittedApproval=null;
                if(Convert.ToBoolean(V(p,"success",false))){string action=S(p,"action");if(action=="project.add")Banner("项目已授权，可在平板的新对话中选择。",false);else if(action=="project.remove")Banner("已移除项目授权，磁盘文件未删除。",false);else if(action=="device.revoke")Banner("设备已撤销。重新连接需要再次配对。",false);else if(action=="approval.decide")Banner("决定已处理，执行结果以 Codex 的最终状态为准。",false);else if(action=="pair.confirm")Banner("配对请求已处理，请查看平板的连接结果。",false);}break;
            case "error":syncing=false;syncWorkspaces.Enabled=true;syncWorkspaces.Text="同步 Codex 工作区";pairCreating=false;createQr.Enabled=address.Items.Count>0;submittedApproval=null;Banner(S(p,"message"),true);UpdateApproval();break;
            case "exit":exiting=true;Close();break;
        }
    }
    private void UpdateAddresses(object values,string listening){
        string selected=Convert.ToString(address.SelectedItem);var items=((IEnumerable)values).Cast<object>().Select(Convert.ToString).Distinct().ToArray();if(!address.Items.Cast<string>().SequenceEqual(items)){address.Items.Clear();address.Items.AddRange(items);if(items.Contains(selected))address.SelectedItem=selected;else if(items.Contains(listening)&&listening!="127.0.0.1")address.SelectedItem=listening;else address.SelectedItem=items.FirstOrDefault(a=>a!="127.0.0.1")??items.FirstOrDefault();}createQr.Enabled=address.Items.Count>0&&!pairCreating;
    }
    private void VerifyLayout(){
        PerformLayout();pages.PerformLayout();pageMap[currentPage].PerformLayout();bool buttonsFit=true;
        Control[] controls=currentPage=="approvals"?new Control[]{allow,reject}:currentPage=="pair"?new Control[]{createQr,syncWorkspaces}:currentPage=="projects"?new Control[]{removeProject}:new Control[]{revokeDevice};
        foreach(Control c in controls){Point pos=pages.PointToClient(c.PointToScreen(Point.Empty));buttonsFit&=c.Right<=c.Parent.ClientSize.Width&&c.Bottom<=c.Parent.ClientSize.Height&&pos.X>=0&&pos.X+c.Width<=pages.ClientSize.Width; if(currentPage!="pair")buttonsFit&=pos.Y>=0&&pos.Y+c.Height<=pages.ClientSize.Height;}
        Console.Out.WriteLine(json.Serialize(new{borderless=FormBorderStyle==FormBorderStyle.None,sidebarVisible=false,syncEnabled=syncWorkspaces.Enabled,projects=projects.Items.Count,approvals=approvals.Items.Count,approvalTabVisible=currentPage=="approvals",page=currentPage,approvalContext=approvalContext.Text,approveEnabled=allow.Enabled,rejectEnabled=reject.Enabled,buttonsFit=buttonsFit,clientWidth=ClientSize.Width,clientHeight=ClientSize.Height,selectedProject=S(Selected(projects),"projectId"),projectPath=projectPath.Text,selectedAddress=Convert.ToString(address.SelectedItem),copyPairingEnabled=copyQr.Enabled,qrVisible=qr.Image!=null,qrStatus=qrStatus.Text}));Console.Out.Flush();
    }
    protected override void Dispose(bool disposing){if(disposing){timer.Stop();timer.Dispose();tray.Visible=false;tray.Dispose();rowImages.Dispose();ClearQr();}base.Dispose(disposing);if(disposing){if(navRegular!=null)navRegular.Dispose();if(navBold!=null)navBold.Dispose();}}
    [STAThread] public static int Main(string[] args){Console.SetIn(new StreamReader(Console.OpenStandardInput(),new System.Text.UTF8Encoding(false),false));Console.SetOut(new StreamWriter(Console.OpenStandardOutput(),new System.Text.UTF8Encoding(false)){AutoFlush=true});Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);using(var form=new HostUi(args.Length==1&&args[0]=="--verify-state"))Application.Run(form);return Environment.ExitCode;}
}
