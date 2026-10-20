using System;
using System.Security.Cryptography;
using System.Text;

internal static class Dpapi {
    public static int Main(string[] args) {
        byte[] input = null;
        try {
            if (args.Length != 1 || (args[0] != "protect" && args[0] != "unprotect")) return 2;
            string line = Console.In.ReadToEnd();
            if (line.Length > 65536) return 2;
            input = Convert.FromBase64String(line.Trim());
            byte[] entropy = Encoding.UTF8.GetBytes("AgentDeck/v1/CurrentUser");
            byte[] output = args[0] == "protect"
                ? ProtectedData.Protect(input, entropy, DataProtectionScope.CurrentUser)
                : ProtectedData.Unprotect(input, entropy, DataProtectionScope.CurrentUser);
            Console.Out.Write(Convert.ToBase64String(output));
            Array.Clear(output, 0, output.Length);
            return 0;
        } catch { return 1; }
        finally { if (input != null) Array.Clear(input, 0, input.Length); }
    }
}
