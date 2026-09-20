$(function(){
    
    $('html,body').stop().animate({scrollTop: '0px'}, 100);
    if ($(window).width() >= 768) {
        skrollr.init({});
    }
    
    //$('input, textarea').placeholder();          //placeholder在IE中的兼容

    // -----------------------------------------搜索框
    $(".search input").focus(function(){
        $(".search button").html("搜索");
        $(".search button").stop().animate({"width":"50px"},400);
    })
    $(".search input").blur(function(){
        $(".search button").html("");
        $(".search button").stop().animate({"width":"0px"},400);
    })
    $(".search button").click(function(){
        var val = $(this).prev("input").val();
        window.location.href = "../News/search.html?catetype=1&keywords=" + val;
        $(this).stop().animate({"width":"0px"},400);
        $(".search button").html("");
    })
    $(".search input").keydown(function(e){
        if(e.keyCode == 13){
            var val = $(this).val();
            window.location.href = "../News/search.html?catetype=1&keywords=" + val;
        }
    });




    // --------------------------------------------------------就业管理input
    $(".form-group input").focus(function () {
        if ($(this).hasClass("readonly")) {

        }else if($(this).attr("readonly")=="readonly"){

        }else if($(this).attr("readonly")==true){

        } else {
            if ($(this).val() == "暂无数据"||$(this).val() == "请以X省X市县区X街道镇乡X村路门牌号的格式填写") {
                $(this).val("");
            }
        }
    })
    $(".form-group input").blur(function () {
        if ($(this).val() == "") {
            $(this).val("暂无数据");
        }
    })

    
    // ----------------------------------------面包屑导航
    // $(".navbar-toggle").click(function(){
    //     if($(this).hasClass("is-open")){
    //         $(this).removeClass("is-open");
    //         $(this).find("span").eq(0).css("visibility","visible");
    //     }else{
    //         $(this).addClass("is-open");
    //         $(this).find("span").eq(0).css("visibility","hidden");
    //         $(this).find("span").eq(1).stop().animate({"transform":"rotate(-30deg)" });
    //     }
    // })
    // ---------------------------------------二级菜单
    $(".stu").hover(function(){
        $(this).find(".stu_01").stop().slideDown();
    },function(){
        $(this).find(".stu_01").css("display","none");
    })
    $(".stu").click(function(){
        if($(this).find(".stu_01").css("display")=="block"){
            $(this).find(".stu_01").css("display","none");
        }else{
            $(this).find(".stu_01").stop().slideDown();
        }
    })
    // ----------------------------------------登录
    $(".login").mouseover(function(){
        // $(".login>p>span").css("color","orange");
        $(".login>div").stop().slideDown();
        $(".login>div").mouseover(function(){
            $(this).css("display","block");
        });
        $(".login>div").mouseleave(function(){
            $(this).stop().slideUp();
        });
    })
    $(".login").mouseleave(function(){
        // $(".login>p>span").css("color","#3C84E8");
        $(".login>div").stop().slideUp();
    })
    $(".login").click(function(){
        if($(".login>div").css("display")=="block"){
            $(".login>div").css("display","none");
        }else{
            $(".login>div").stop().slideDown();
        }
    })
    // -----------------------------页脚时间
    $(function(){
        var date=new Date();
        var year=date.getFullYear();
        $(".year").html(year);
    })
    // -----------------------------------------------------回到页面顶部
    $(window).scroll(function(){
        if($(window).scrollTop() > 200){
            $(".toTop").show();
        }else{
            $(".toTop").hide();
        }
    })
    if($(window).scrollTop() > 200){
        $(".toTop").show();
    }else{
        $(".toTop").hide(); 
    }
    $(".toTop").hover(function(){
        $(this).stop().animate({"bottom":"210px","background-color":"#055da4"},400);
    },function(){
        $(this).stop().animate({"bottom":"200px","background-color":"#3C84E8"},400);
    })
    function scroll(){
        if(window.pageYOffset !== undefined){
            return {
                top:window.pageYOffset,
                left:window.pageXOffset
            }
        }else {
            return {
                top: document.documentElement.scrollTop,
                left: document.documentElement.scrollLeft
            }
        }
    }
    function animate_slow_speed_Y(endY){
        clearInterval(timer);
        var nowY=scroll().top;
        var timer=setInterval(function(){
            var step=(endY-nowY)/10;
            step=step>0?Math.ceil(step):Math.floor(step);
            nowY=nowY+step;
            window.scrollTo(0,nowY);
            if(Math.abs(endY-nowY)<=Math.abs(step)){
                window.scrollTo(0,endY);
                clearInterval(timer);
            }
        },30)
    }
    $(".toTop").click(function(){
        animate_slow_speed_Y("0");
    })
    // -----------------------------------访问量
    var school_id = sessionStorage.getItem('school_id');
    http('POST', '/schoolbrowse/browse', {"school_id":school_id}, function (e) {
        // console.log(e,456)
        $(".history").html(e.data.allcount);
        // $(".day_").html(e.data.currcount)
    });
})