# Set up Microsoft word meanings

Word meanings are optional. Caption filtering works without a Microsoft key.
This guide uses Azure's international service.

## 1. Set the Azure portal language to English

Open [Azure](https://portal.azure.com/) and sign in. **Before following the
steps below, change the portal language to English.**

1. Select the **⚙** icon at the top right.
2. Open the language settings (**Language + region** in English).
3. Set **Language** to **English**, then apply the change (**Apply** in English).

The portal may reload. All menu and button names below refer to the English UI.
Microsoft's [portal language guide](https://learn.microsoft.com/en-us/azure/azure-portal/set-preferences#language--region)
shows this setting. It changes the portal's language, not your translation language.

## 2. Create a Translator resource

You need an active Azure subscription. If you do not have one, start from the
[Azure account page](https://azure.microsoft.com/en-us/free/). Signup may ask
for a phone number and a payment card for verification. Use your real billing
details. Azure's account trial and Translator's free tier are separate.

1. In the portal search bar, search for **Translator** (it may be shown as
   **Azure Translator**). Open the service and select **Create**.
2. Choose the single-service Translator resource.
3. Set these fields:

| Field | Value |
| --- | --- |
| Subscription | Your active subscription |
| Resource group | Use an existing group or create one, such as `clever-subtitle` |
| Translator's Region | **Global** if offered, or an available supported region |
| Name | A unique name, such as `clever-subtitle-dictionary` |
| Pricing tier | **Free F0** |

**There are two region settings.** If you open a separate **Create a resource
group** page, its Region is a location such as **East US**. Choose any available
one for this setup. It stores the group's metadata and does not determine
your Translator key's region. A resource group can contain resources in other
regions. See Microsoft's
[resource group guide](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/manage-resource-groups-portal#what-is-a-resource-group).

On the **Translator** creation page, Region belongs to the Translator service.
Global and regional Translator resources both work with the extension. Keep
track of that service region for the extension's settings.

4. Select **Review + create**, check **F0**, then select **Create**.
5. When deployment finishes, select **Go to resource**.

Each subscription can have one free Translator resource. If F0 is unavailable,
check whether you already have one under **All resources**. See the
[official resource guide](https://learn.microsoft.com/en-us/azure/ai-services/translator/how-to/create-translator-resource).

## 3. Copy your key

In the resource's left menu, open **Resource Management → Keys and Endpoint**.
Copy either **KEY 1** or **KEY 2**. Keep it private and enter it only in the
extension's settings.

## 4. Save it in the extension

Open **Settings → Dictionary**:

1. Set **Source** to **Microsoft Translator (online)**.
2. Choose **Translate to**.
3. Paste your key into **Microsoft API key**.
4. Set **Translator region** using the **Translator resource that owns your
   key**. Leave it empty for **Global**. For a regional Translator resource,
   enter its code, such as `eastus` for **East US**. The resource group's
   Region is not used in this field.
5. Choose a **Try a word**, such as the default `hello`.
6. Select **Save and check**, allowing Microsoft access if the browser asks.

A successful check shows real meanings on this page. A failed check keeps your
last working settings. After saving, the key box clears; an empty box keeps
your saved key. Configure the key separately on each device.

## Use and limits

- Microsoft receives the queried word, the target language, and the required
  authentication headers. No caption sentence, video title, or vocabulary list
  is submitted. Lookup shows up to three different translations, sorted by
  Microsoft's score. It does not choose the meaning used in the sentence.
- The saved key stays in this browser's extension storage. It is not in Git
  vocabulary sync, TXT exports, or installation ZIPs.
- F0 currently includes two million characters per month. The API counts the
  submitted word's characters. Check the
  [current pricing](https://azure.microsoft.com/en-us/pricing/details/translator/).
- Keeping Translator on F0 is separate from keeping the Azure account active.
  After an account trial ends, Azure may ask you to switch the subscription to
  pay as you go; the Translator resource can still use F0.

## Help

- **Key check failed:** confirm that the key belongs to an international Azure
  Translator resource and that the region matches. Paste the key only.
- **Request or monthly limit reached:** check the resource's usage in Azure.
- **Microsoft took too long / could not be reached:** check the connection and
  retry. You can also choose a downloaded WikDict dictionary for offline use.
- **Kiwi could not show an access prompt:** use the Kiwi installation ZIP.

The [Dictionary Lookup documentation](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/v3/dictionary-lookup)
describes the official API used here.
