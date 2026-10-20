using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Web.Script.Serialization;

internal static class Certificate {
    private static byte[] Der(byte tag, byte[] value) {
        var result=new List<byte>();result.Add(tag);
        if(value.Length<128)result.Add((byte)value.Length);
        else {var length=new List<byte>();int n=value.Length;while(n>0){length.Insert(0,(byte)(n&255));n>>=8;}result.Add((byte)(128|length.Count));result.AddRange(length);}
        result.AddRange(value);return result.ToArray();
    }
    private static byte[] Integer(byte[] value) {
        int first=0;while(first<value.Length-1 && value[first]==0)first++;
        value=value.Skip(first).ToArray();if(value.Length==0)value=new byte[]{0};
        if(value[0]>=128)value=(new byte[]{0}).Concat(value).ToArray();
        return Der(2,value);
    }
    private static string Pem(string label,byte[] bytes) {return "-----BEGIN "+label+"-----\n"+Convert.ToBase64String(bytes,Base64FormattingOptions.InsertLineBreaks)+"\n-----END "+label+"-----\n";}
    public static int Main(string[] args) {
        try {
            var json=new JavaScriptSerializer();var addresses=json.Deserialize<string[]>(Console.In.ReadToEnd());
            using(var rsa=new RSACng(3072)) {
                var request=new CertificateRequest(new X500DistinguishedName("CN=AgentDeck Local Bridge"),rsa,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1);
                request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false,false,0,true));
                request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature|X509KeyUsageFlags.KeyEncipherment,true));
                var usages=new OidCollection();usages.Add(new Oid("1.3.6.1.5.5.7.3.1"));request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(usages,true));
                var san=new SubjectAlternativeNameBuilder();san.AddDnsName("localhost");foreach(string address in addresses)san.AddIpAddress(IPAddress.Parse(address));request.CertificateExtensions.Add(san.Build());
                using(var cert=request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-5),DateTimeOffset.UtcNow.AddYears(args.Length==1 && args[0]=="test-public"?20:1))) {
                    var p=rsa.ExportParameters(true);
                    var values=new[]{new byte[]{0},p.Modulus,p.Exponent,p.D,p.P,p.Q,p.DP,p.DQ,p.InverseQ};
                    byte[] key=Der(48,values.SelectMany(Integer).ToArray());
                    Console.Out.Write(json.Serialize(new {cert=Pem("CERTIFICATE",cert.RawData),key=Pem("RSA PRIVATE KEY",key)}));
                    Array.Clear(key,0,key.Length);foreach(byte[] v in values)Array.Clear(v,0,v.Length);
                }
            }
            return 0;
        } catch {return 1;}
    }
}
