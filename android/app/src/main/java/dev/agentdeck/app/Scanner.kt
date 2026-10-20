package dev.agentdeck.app

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import androidx.compose.material3.Text

@androidx.annotation.OptIn(ExperimentalGetImage::class)
@Composable fun QrScanner(modifier:Modifier=Modifier,onResult:(String)->Unit){
    val context=LocalContext.current;val owner=LocalLifecycleOwner.current
    var granted by remember{mutableStateOf(ContextCompat.checkSelfPermission(context,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)}
    val permission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){granted=it}
    LaunchedEffect(Unit){if(!granted)permission.launch(Manifest.permission.CAMERA)}
    if(!granted){Text("需要相机权限才能扫描，也可以粘贴配对信息。");return}
    val preview=remember{PreviewView(context)};val executor=remember{Executors.newSingleThreadExecutor()}
    val scanner=remember{BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build())}
    val currentResult by rememberUpdatedState(onResult)
    DisposableEffect(owner){
        var provider:ProcessCameraProvider?=null;var disposed=false;var detected=false
        val future=ProcessCameraProvider.getInstance(context)
        future.addListener({if(!disposed){try{provider=future.get();val cameraPreview=Preview.Builder().build().also{it.surfaceProvider=preview.surfaceProvider};val analysis=ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build();analysis.setAnalyzer(executor){proxy->val image=proxy.image;if(image==null||detected){proxy.close()}else{scanner.process(InputImage.fromMediaImage(image,proxy.imageInfo.rotationDegrees)).addOnSuccessListener{codes->val raw=codes.firstOrNull()?.rawValue;if(raw!=null&&!detected){detected=true;currentResult(raw)}}.addOnCompleteListener{proxy.close()}}};provider?.bindToLifecycle(owner,CameraSelector.DEFAULT_BACK_CAMERA,cameraPreview,analysis)}catch(_:Exception){}}},ContextCompat.getMainExecutor(context))
        onDispose{disposed=true;provider?.unbindAll();scanner.close();executor.shutdown()}
    }
    AndroidView(factory={preview},modifier=modifier)
}
